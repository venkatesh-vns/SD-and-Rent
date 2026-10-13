/**
 * Validation for the Rent Transaction masters, shared by manual entry, edit
 * and bulk upload (scope document 7.1). Each validate*() takes the user's
 * values (screen field names, DD/MM/YYYY dates) plus the stored record when
 * editing, and returns { rec, errors } - rec in database column names.
 */
const sdMasterModel = require('../models/sdMasterModel');
const rentMasterModel = require('../models/rentMasterModel');
const agreementModel = require('../models/rentAgreementModel');
const ruleModel = require('../models/rentRuleModel');
const waiverModel = require('../models/rentWaiverModel');
const { COMPONENTS, BY_CODE, triggerName, findComponent, parseComponentList } = require('./rentComponents');
const { escalationChain } = require('./rentCalc');
const { parseDMY, formatDMY } = require('../utils/dates');

const LL_STATUSES = ['Active', 'Inactive'];
const AGREEMENT_STATUSES = ['Individual', 'Transfer'];
const RECORD_STATUSES = ['Active', 'Inactive'];
const RULE_TYPES = ['LCD', 'RCD', 'Normal Day'];
const WAIVER_STATUSES = ['Yes', 'No'];
const REMARK_MAX = 500;

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const text = (v) => (blank(v) ? null : String(v).trim());
const pick = (list, v) => (blank(v) ? null : list.find((x) => x.toLowerCase() === String(v).trim().toLowerCase()) || undefined);
const dmy = (iso) => formatDMY(iso);

// '1,23,456.50' -> 123456.5; undefined when not a number
function parseNumber(v) {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/[,\s₹%]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

// Date field: { value: 'YYYY-MM-DD' | null, error }
function dateField(v, label, required) {
  if (blank(v)) return required ? { value: null, error: `${label} is required.` } : { value: null };
  const value = parseDMY(v);
  return value ? { value } : { value: null, error: `${label} must be a valid date as DD/MM/YYYY.` };
}

// Rent Master Business Key: Cost Center Name | SD Code | Floor | Landlord Name
const businessKey = (...parts) => parts.map((p) => String(p || '').trim().replace(/\s+/g, ' ').toUpperCase()).join(' | ');

async function resolveRent(input) {
  if (!blank(input.rentId)) return rentMasterModel.findById(Number(input.rentId));
  if (!blank(input.rentCode)) return rentMasterModel.findByCode(input.rentCode);
  return null;
}

// ------------------------------------------------------------ Rent Master
async function validateRentMaster(input, before = null) {
  const errors = [];
  const err = (field, value, error) => errors.push({ field, value: value ?? '', error });

  let sd = null;
  if (!blank(input.sdId)) sd = await sdMasterModel.findById(Number(input.sdId));
  else if (!blank(input.sdCode)) sd = await sdMasterModel.findByCode(String(input.sdCode).trim());
  if (!sd) err('SD Code', input.sdCode ?? input.sdId, blank(input.sdCode) && blank(input.sdId) ? 'SD Code is required.' : 'SD Code not found in SD Master.');

  if (sd) {
    if (!sd.rent_commencement_date) err('RCD', sd.sd_code, `SD ${sd.sd_code} has no Rent Commencement Date. Update it in SD Master first.`);
    if (!sd.lease_end_date) err('LED', sd.sd_code, `SD ${sd.sd_code} has no Lease End Date. Update it in SD Master first.`);
    // Values given in an upload for SD-sourced fields must match SD Master
    const mustMatch = [
      ['Cost Center', input.costCenter, sd.cost_center_name],
      ['Floor', input.floor, sd.floor],
      ['LCD', input.lcd, dmy(sd.lease_commencement_date)],
      ['RCD', input.rcd, dmy(sd.rent_commencement_date)],
      ['LED', input.led, dmy(sd.lease_end_date)],
    ];
    mustMatch.forEach(([label, given, actual]) => {
      if (blank(given)) return;
      const g = /CD|LED/.test(label) ? dmy(parseDMY(given) || '') || String(given).trim() : String(given).trim();
      if (g.toLowerCase() !== String(actual || '').toLowerCase()) err(label, given, `${label} does not match SD ${sd.sd_code} (${actual || 'blank'}). It is taken from SD Master and cannot be changed here.`);
    });
  }

  const landlord = text(input.landlordName);
  if (!landlord) err('Landlord Name', '', 'Landlord Name is required.');
  else if (landlord.length > 200) err('Landlord Name', landlord, 'Landlord Name must be 200 characters or fewer.');

  const llStatus = pick(LL_STATUSES, input.llStatus) ?? (blank(input.llStatus) ? null : undefined);
  if (llStatus === null) err('LL Status', '', 'LL Status is required.');
  if (llStatus === undefined) err('LL Status', input.llStatus, 'LL Status must be Active or Inactive.');

  let inactiveEnd = null;
  if (llStatus === 'Inactive') {
    const d = dateField(input.inactiveEndDate, 'Inactive End Date', true);
    if (d.error) err('Inactive End Date', input.inactiveEndDate, d.error);
    inactiveEnd = d.value;
  }

  const rec = {
    sd_id: sd?.sd_id,
    landlord_name: landlord,
    ll_status: llStatus || null,
    inactive_end_date: inactiveEnd,
    business_key: sd && landlord ? businessKey(sd.cost_center_name, sd.sd_code, sd.floor, landlord) : null,
  };

  if (before && sd && sd.sd_id !== before.sd_id) {
    const used = await rentMasterModel.usage(before.rent_id);
    if (used.agreements || used.rules || used.waivers) err('SD Code', sd.sd_code, `${before.rent_code} already has agreements, rules or waivers; its SD Code cannot be changed.`);
  }
  if (rec.business_key && errors.length === 0) {
    const dup = await rentMasterModel.findByBusinessKey(rec.business_key);
    if (dup && dup.rent_id !== before?.rent_id) {
      err('Landlord Name', landlord, `${dup.rent_code} already exists for this Cost Center, SD Code, Floor and Landlord Name.`);
    }
  }
  return { rec, errors, sd };
}

// ------------------------------------------------------------ Rent Agreement
// components input: { OFFICE: { quantity, rate, percentage }, SIGNAGE: { rate, percentage }, ... }
function parseComponents(input, errors) {
  const out = [];
  for (const c of COMPONENTS) {
    const v = input?.[c.code] || {};
    const label = c.label;
    const trig = c.unit === 'month' ? v.rate : v.quantity;
    const others = c.unit === 'month' ? [['%', v.percentage]] : [['Rate', v.rate], ['%', v.percentage]];
    if (blank(trig)) {
      if (others.some(([, x]) => !blank(x))) errors.push({ field: label, value: '', error: `${label}: enter ${triggerName(c)} first, or clear the other fields.` });
      continue;
    }
    const nums = { trigger: parseNumber(trig), rate: parseNumber(v.rate), percentage: parseNumber(v.percentage) };
    if (nums.trigger === undefined || nums.trigger <= 0) {
      errors.push({ field: `${label} ${triggerName(c)}`, value: trig, error: `${label}: ${triggerName(c)} must be a number greater than 0.` });
      continue;
    }
    let ok = true;
    for (const [name, raw] of others) {
      const n = name === 'Rate' ? nums.rate : nums.percentage;
      if (blank(raw)) { errors.push({ field: `${label} ${name}`, value: '', error: `${label}: ${name} is required once ${triggerName(c)} is entered.` }); ok = false; }
      else if (n === undefined || n <= 0) { errors.push({ field: `${label} ${name}`, value: raw, error: `${label}: ${name} must be a number greater than 0.` }); ok = false; }
    }
    if (!ok) continue;
    out.push(c.unit === 'month'
      ? { component_code: c.code, quantity: null, rate: nums.trigger, percentage: nums.percentage }
      : { component_code: c.code, quantity: nums.trigger, rate: nums.rate, percentage: nums.percentage });
  }
  return out;
}

// Comparable fingerprint of the nine trigger values (scope 3.4)
const triggerKey = (components) => COMPONENTS.map((c) => {
  const x = components.find((y) => y.component_code === c.code);
  if (!x) return '';
  return Number(c.unit === 'month' ? x.rate : x.quantity).toString();
}).join('|');

const sameComponents = (a, b) => JSON.stringify(normalizeComponents(a)) === JSON.stringify(normalizeComponents(b));
const normalizeComponents = (list) => [...list].map((c) => ({
  component_code: c.component_code, quantity: c.quantity === null ? null : Number(c.quantity), rate: Number(c.rate), percentage: Number(c.percentage),
})).sort((x, y) => (x.component_code < y.component_code ? -1 : 1));

async function validateAgreement(input, before = null) {
  const errors = [];
  const err = (field, value, error) => errors.push({ field, value: value ?? '', error });

  const rent = await resolveRent(input);
  if (!rent) err('Rent Code', input.rentCode ?? input.rentId, blank(input.rentCode) && blank(input.rentId) ? 'Rent Code is required.' : 'Rent Code not found in Rent Master.');

  const agreementStatus = pick(AGREEMENT_STATUSES, input.agreementStatus);
  if (!agreementStatus) err('Agreement Status', input.agreementStatus, blank(input.agreementStatus) ? 'Agreement Status is required.' : 'Agreement Status must be Individual or Transfer.');
  const status = blank(input.status) ? 'Active' : pick(RECORD_STATUSES, input.status);
  if (!status) err('Status', input.status, 'Status must be Active or Inactive.');
  const remark = text(input.remark);
  if (remark && remark.length > REMARK_MAX) err('Remark', `${remark.slice(0, 20)}...`, `Remark must be ${REMARK_MAX} characters or fewer.`);

  let components = parseComponents(input.components, errors);

  // Transfer: configuration from another Rent Code of the same SD from a date
  let source = null;
  let effective = null;
  if (agreementStatus === 'Transfer') {
    source = !blank(input.transferFromRentId) ? await rentMasterModel.findById(Number(input.transferFromRentId))
      : !blank(input.transferFromRentCode) ? await rentMasterModel.findByCode(input.transferFromRentCode) : null;
    if (!source) err('Transfer From Rent Code', input.transferFromRentCode, blank(input.transferFromRentCode) && blank(input.transferFromRentId) ? 'Transfer From Rent Code is required for a Transfer.' : 'Transfer From Rent Code not found.');
    const d = dateField(input.transferEffectiveDate, 'Transfer Effective Date', true);
    if (d.error) err('Transfer Effective Date', input.transferEffectiveDate, d.error);
    effective = d.value;
    if (rent && source) {
      if (source.rent_id === rent.rent_id) err('Transfer From Rent Code', source.rent_code, 'A Rent Code cannot transfer to itself.');
      else if (source.sd_id !== rent.sd_id) err('Transfer From Rent Code', source.rent_code, `${source.rent_code} belongs to SD ${source.sd_code}; a transfer must stay on the same SD Code (${rent.sd_code}).`);
      const from = await agreementModel.forRents([source.rent_id]);
      const sourceAgreement = from.find((a) => a.status === 'Active');
      if (!sourceAgreement) err('Transfer From Rent Code', source.rent_code, `${source.rent_code} has no active Rent Agreement to transfer.`);
      else if (!components.length && !errors.some((e) => /: /.test(e.error))) components = sourceAgreement.components.map((c) => ({ ...c }));
      if (effective && rent.rcd && effective < rent.rcd) err('Transfer Effective Date', input.transferEffectiveDate, `Transfer Effective Date cannot be before the RCD (${dmy(rent.rcd)}).`);
      if (effective && rent.led && effective > rent.led) err('Transfer Effective Date', input.transferEffectiveDate, `Transfer Effective Date cannot be after the LED (${dmy(rent.led)}).`);
    }
  }
  if (!components.length && !errors.some((e) => COMPONENTS.some((c) => e.field.startsWith(c.label)))) {
    err('Components', '', 'Enter at least one rent or charge component.');
  }

  const rec = {
    rent_id: rent?.rent_id,
    agreement_status: agreementStatus,
    status,
    transfer_from_rent_id: agreementStatus === 'Transfer' ? source?.rent_id ?? null : null,
    transfer_effective_date: agreementStatus === 'Transfer' ? effective : null,
    remark,
    components,
  };

  if (errors.length === 0) {
    // In use (rules or schedule): only Status and Remark may change (scope 3.5)
    if (before) {
      const used = await agreementModel.usage(before);
      const changed = rec.rent_id !== before.rent_id || rec.agreement_status !== before.agreement_status
        || (rec.transfer_from_rent_id || null) !== (before.transfer_from_rent_id || null)
        || (rec.transfer_effective_date || null) !== (before.transfer_effective_date || null)
        || !sameComponents(rec.components, before.components);
      if (changed && (used.rules || used.schedule_lines)) {
        err('Rent Agreement', before.rent_code, `This agreement is already used in ${used.rules ? 'Rule Master' : 'Rent Schedule'}; it cannot be edited, only made Inactive. Add a new agreement instead.`);
      }
    }
    // One active configuration per Rent Code + Agreement Status (scope 3.6)
    if (status === 'Active') {
      const active = await agreementModel.findActive(rec.rent_id, agreementStatus);
      if (active && active.agreement_id !== before?.agreement_id) {
        err('Agreement Status', agreementStatus, `${rent.rent_code} already has an active ${agreementStatus} agreement (ID ${active.agreement_id}). Make it Inactive first.`);
      }
    }
    // Same Rent Code + Agreement Status + component values already saved (scope 3.4)
    const others = (await agreementModel.forRents([rec.rent_id]))
      .filter((a) => a.agreement_status === agreementStatus && a.agreement_id !== before?.agreement_id);
    const key = triggerKey(rec.components);
    const dup = others.find((a) => triggerKey(a.components) === key);
    if (dup) err('Components', '', `An agreement with the same Rent Code, Agreement Status and component values already exists (ID ${dup.agreement_id}, ${dup.status}).`);
  }
  return { rec, errors, rent, source };
}

// ------------------------------------------------------------ Rule Master
async function validateRule(input, before = null) {
  const errors = [];
  const err = (field, value, error) => errors.push({ field, value: value ?? '', error });

  const rent = await resolveRent(input);
  if (!rent) err('Rent Code', input.rentCode ?? input.rentId, blank(input.rentCode) && blank(input.rentId) ? 'Rent Code is required.' : 'Rent Code not found in Rent Master.');
  else if (!(await agreementModel.forRents([rent.rent_id])).some((a) => a.status === 'Active')) {
    err('Rent Code', rent.rent_code, `${rent.rent_code} has no active Rent Agreement. Add one in Rent Agreement Master first.`);
  }

  const raw = String(input.ruleType || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const ruleType = raw === 'normal' ? 'Normal Day' : pick(RULE_TYPES, raw);
  if (!ruleType) err('Rule Type', input.ruleType, blank(input.ruleType) ? 'Rule Type is required.' : 'Rule Type must be LCD, RCD or Normal Day.');

  let months = null;
  let from = null;
  let to = null;
  if (ruleType === 'LCD' || ruleType === 'RCD') {
    months = parseNumber(input.escalationMonths);
    if (months === null) err('Escalation Month', '', 'Escalation Month is required.');
    else if (months === undefined || !Number.isInteger(months) || months < 1 || months > 600) err('Escalation Month', input.escalationMonths, 'Escalation Month must be a whole number of months from 1 to 600.');
  } else if (ruleType === 'Normal Day') {
    const f = dateField(input.fromDate, 'From Date', true);
    const t2 = dateField(input.toDate, 'To Date', true);
    if (f.error) err('From Date', input.fromDate, f.error);
    if (t2.error) err('To Date', input.toDate, t2.error);
    from = f.value;
    to = t2.value;
    if (from && to && from > to) err('From Date', input.fromDate, 'From Date must be on or before To Date.');
    if (rent && from && to) {
      const start = [rent.lcd, rent.rcd].filter(Boolean).sort()[0];
      if (start && from < start) err('From Date', input.fromDate, `From Date cannot be before the lease start (${dmy(start)}).`);
      if (rent.led && to > rent.led) err('To Date', input.toDate, `To Date cannot be after the LED (${dmy(rent.led)}).`);
    }
  }

  const percentage = parseNumber(input.percentage);
  if (percentage === null) err('Percentage', '', 'Percentage is required (it may be 0 or negative).');
  else if (percentage === undefined || percentage < -100 || percentage > 1000) err('Percentage', input.percentage, 'Percentage must be a number from -100 to 1000.');

  const applies = parseComponentList(input.componentCodes);
  if (applies.unknown.length) err('Applies to', applies.unknown.join(', '), 'Component not recognised. Leave Applies to empty for all components.');
  const status = blank(input.status) ? 'Active' : pick(RECORD_STATUSES, input.status);
  if (!status) err('Status', input.status, 'Status must be Active or Inactive.');

  const rec = {
    rent_id: rent?.rent_id, rule_type: ruleType, escalation_months: months, from_date: from, to_date: to,
    percentage, component_codes: applies.codes, status,
  };
  let chain = [];
  if (errors.length === 0) {
    const others = (await ruleModel.forRent(rent.rent_id)).filter((r) => r.rule_id !== before?.rule_id);
    // RCD and LCD rules cannot be mixed on one Rent Code (scope 4.2)
    if (status === 'Active' && (ruleType === 'LCD' || ruleType === 'RCD')) {
      const other = ruleType === 'LCD' ? 'RCD' : 'LCD';
      if (others.some((r) => r.status === 'Active' && r.rule_type === other)) {
        err('Rule Type', ruleType, `${rent.rent_code} already has active ${other} rules; LCD and RCD rules cannot be combined.`);
      }
      const base = ruleType === 'LCD' ? rent.lcd : rent.rcd;
      if (!base) err('Rule Type', ruleType, `SD ${rent.sd_code} has no ${ruleType === 'LCD' ? 'Lease' : 'Rent'} Commencement Date.`);
    }
    // Escalation dates (this rule in its place in the chain) must stay within the LED
    const candidate = { ...rec, rule_id: before?.rule_id ?? Number.MAX_SAFE_INTEGER };
    chain = escalationChain([...others, candidate], rent);
    for (const r of chain) {
      if (!r.effective_date || !rent.led) continue;
      const tooLate = r.rule_type === 'RCD' ? r.effective_date >= rent.led : r.effective_date > rent.led;
      if (tooLate) {
        const which = r.rule_id === candidate.rule_id ? 'This rule' : `Rule ${r.rule_id}`;
        err('Escalation Month', months, `${which} would escalate on ${dmy(r.effective_date)}, which is ${r.rule_type === 'RCD' ? 'not before' : 'after'} the LED (${dmy(rent.led)}).`);
      }
    }
  }
  return { rec, errors, rent, chain };
}

// ------------------------------------------------------------ Waiver Master
async function validateWaiver(input, before = null) {
  const errors = [];
  const err = (field, value, error) => errors.push({ field, value: value ?? '', error });

  const rent = await resolveRent(input);
  if (!rent) err('Rent Code', input.rentCode ?? input.rentId, blank(input.rentCode) && blank(input.rentId) ? 'Rent Code is required.' : 'Rent Code not found in Rent Master.');
  else if (!(await agreementModel.forRents([rent.rent_id])).length) {
    err('Rent Code', rent.rent_code, `${rent.rent_code} has no Rent Agreement. Add one in Rent Agreement Master first.`);
  }

  const f = dateField(input.fromDate, 'From Date', true);
  const t2 = dateField(input.toDate, 'To Date', true);
  if (f.error) err('From Date', input.fromDate, f.error);
  if (t2.error) err('To Date', input.toDate, t2.error);
  const from = f.value;
  const to = t2.value;
  if (from && to && from > to) err('From Date', input.fromDate, 'From Date must be on or before To Date.');
  if (rent && from && to) {
    const start = rent.lcd || rent.rcd;
    if (start && from < start) err('From Date', input.fromDate, `From Date cannot be before the lease start (LCD ${dmy(start)}).`);
    if (rent.led && to > rent.led) err('To Date', input.toDate, `To Date cannot be after the LED (${dmy(rent.led)}).`);
  }

  const waiverStatus = pick(WAIVER_STATUSES, input.waiverStatus);
  if (!waiverStatus) err('Waiver Status', input.waiverStatus, blank(input.waiverStatus) ? 'Waiver Status is required.' : 'Waiver Status must be Yes or No.');
  const applies = parseComponentList(input.componentCodes);
  if (applies.unknown.length) err('Applies to', applies.unknown.join(', '), 'Component not recognised. Leave Applies to empty to waive all components.');
  const remark = text(input.remark);
  if (remark && remark.length > REMARK_MAX) err('Remark', `${remark.slice(0, 20)}...`, `Remark must be ${REMARK_MAX} characters or fewer.`);

  const rec = { rent_id: rent?.rent_id, from_date: from, to_date: to, waiver_status: waiverStatus, component_codes: applies.codes, remark };
  if (errors.length === 0 && waiverStatus === 'Yes') {
    const clash = await waiverModel.overlapping(rent.rent_id, from, to, applies.codes, before?.waiver_id);
    if (clash.length) {
      err('From Date', input.fromDate, `Overlaps the waiver ${dmy(clash[0].from_date)} to ${dmy(clash[0].to_date)} of ${rent.rent_code}.`);
    }
  }
  return { rec, errors, rent };
}

module.exports = {
  LL_STATUSES, AGREEMENT_STATUSES, RECORD_STATUSES, RULE_TYPES, WAIVER_STATUSES,
  blank, text, parseNumber, businessKey,
  validateRentMaster, validateAgreement, validateRule, validateWaiver,
};
