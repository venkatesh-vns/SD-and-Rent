// Validation shared by SD Master manual entry and Excel upload.
const sdMasterModel = require('../models/sdMasterModel');
const sdTransactionModel = require('../models/sdTransactionModel');
const costCenterModel = require('../models/costCenterModel');
const locationModel = require('../models/locationModel');
const { parseDMY, formatDMY } = require('../utils/dates');

const SD_STATUSES = ['Active', 'Passive'];

const LABELS = {
  lease_id: 'Lease ID',
  agreement_no: 'Agreement No.',
  cost_center_id: 'Cost Center',
  l1_id: 'Location Level 1',
  l2_id: 'Location Level 2',
  l3_id: 'Location Level 3',
  landlord_name: 'Landlord Name',
  landlord_status: 'Landlord Status',
  building_status: 'Building Status',
  floor: 'Floor',
  agreement_value: 'Agreement Value',
  lease_commencement_date: 'Lease Commencement Date',
  rent_commencement_date: 'Rent Commencement Date',
  lease_end_date: 'Lease End Date',
};

const DATE_FIELDS = ['lease_commencement_date', 'rent_commencement_date', 'lease_end_date'];

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const text = (v) => (blank(v) ? null : String(v).trim());

// '1,50,000.50' -> 150000.5; blank -> null; not a valid amount -> undefined
function parseAmount(value) {
  if (blank(value)) return null;
  const cleaned = String(value).replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

/**
 * Checks a complete record (column names as in sdMasterModel.FIELDS).
 * `raw` holds the values as the user typed them, for messages about
 * unparseable dates/amounts. `before` is the stored record on edit: a
 * master that was already on the record may since have become Inactive.
 * Returns [{ field, value, error }].
 */
async function validateRecord(rec, raw = {}, before = null) {
  const errors = [];
  const fail = (field, error, value = raw[field] ?? rec[field]) =>
    errors.push({ field: LABELS[field], value: value ?? '', error });

  // Text lengths and mandatory text
  [['lease_id', 50], ['agreement_no', 50], ['landlord_name', 200], ['floor', 50]].forEach(([f, max]) => {
    if (rec[f] && rec[f].length > max) fail(f, `Must be ${max} characters or fewer.`);
  });
  if (!rec.floor) fail('floor', 'Floor is required.');

  ['landlord_status', 'building_status'].forEach((f) => {
    if (!rec[f]) fail(f, `${LABELS[f]} is required.`);
    else if (!SD_STATUSES.includes(rec[f])) fail(f, `${LABELS[f]} must be Active or Passive.`);
  });

  // Agreement Value
  if (rec.agreement_value === null) fail('agreement_value', 'Agreement Value is required.');
  else if (rec.agreement_value === undefined) fail('agreement_value', 'Agreement Value must be a number with up to 2 decimals.');
  else if (rec.agreement_value <= 0) fail('agreement_value', 'Agreement Value must be greater than zero.');
  else if (rec.agreement_value >= 1e13) fail('agreement_value', 'Agreement Value is too large.');
  else if (before) {
    const { total_paid: totalPaid } = await sdTransactionModel.getBalance(before.sd_id);
    if (rec.agreement_value < Number(totalPaid)) {
      fail('agreement_value', `Agreement Value cannot be less than the total SD Paid so far (${Number(totalPaid).toFixed(2)}).`);
    }
  }

  // Dates
  DATE_FIELDS.forEach((f) => {
    if (rec[f] === undefined) fail(f, 'Date must be a valid date in DD/MM/YYYY format.');
  });
  if (rec.lease_commencement_date && rec.lease_end_date && rec.lease_end_date < rec.lease_commencement_date) {
    fail('lease_end_date', 'Lease End Date cannot be before Lease Commencement Date.', formatDMY(rec.lease_end_date));
  }

  // Cost Center
  if (!rec.cost_center_id) {
    if (!raw.cost_center_id) fail('cost_center_id', 'Cost Center is required.');
  } else {
    const cc = await costCenterModel.findById(rec.cost_center_id);
    if (!cc) fail('cost_center_id', 'Cost Center not found.');
    else if (cc.status !== 'Active' && cc.cost_center_id !== before?.cost_center_id) {
      fail('cost_center_id', `Cost Center ${cc.cost_center_code} is Inactive.`, cc.cost_center_code);
    }
  }

  // Location hierarchy: each level present, Active (unless unchanged), and consistent
  const levels = [[1, 'l1_id'], [2, 'l2_id'], [3, 'l3_id']];
  const found = {};
  for (const [level, f] of levels) {
    if (!rec[f]) {
      if (!raw[f]) fail(f, `${LABELS[f]} is required.`);
      continue;
    }
    const loc = await locationModel.findById(level, rec[f]);
    if (!loc) {
      fail(f, `${LABELS[f]} not found.`);
      continue;
    }
    found[level] = loc;
    const name = loc[`l${level}_name`];
    if (loc.status !== 'Active' && loc[f] !== before?.[f]) fail(f, `${LABELS[f]} '${name}' is Inactive.`, name);
  }
  if (found[2] && rec.l1_id && found[2].l1_id !== rec.l1_id) {
    fail('l2_id', `Location Level 2 '${found[2].l2_name}' does not belong to the selected Level 1.`, found[2].l2_name);
  }
  if (found[3] && rec.l2_id && found[3].l2_id !== rec.l2_id) {
    fail('l3_id', `Location Level 3 '${found[3].l3_name}' does not belong to the selected Level 2.`, found[3].l3_name);
  }

  // Duplicate business key
  if (rec.floor && (rec.lease_id || rec.agreement_no)) {
    const dup = await sdMasterModel.findByBusinessKey(rec, before?.sd_id);
    if (dup) {
      fail('lease_id', `Lease ID + Agreement No. + Floor already used by ${dup.sd_code}.`,
        [rec.lease_id, rec.agreement_no, rec.floor].filter(Boolean).join(' / '));
    }
  }

  return errors;
}

// Manual entry (JSON body, camelCase, dates DD/MM/YYYY) -> { rec, raw }
function fromBody(body) {
  const raw = {
    lease_commencement_date: body.leaseCommencementDate,
    rent_commencement_date: body.rentCommencementDate,
    lease_end_date: body.leaseEndDate,
    agreement_value: body.agreementValue,
  };
  const id = (v) => (blank(v) ? null : Number(v));
  const rec = {
    lease_id: text(body.leaseId),
    agreement_no: text(body.agreementNo),
    cost_center_id: id(body.costCenterId),
    l1_id: id(body.l1Id),
    l2_id: id(body.l2Id),
    l3_id: id(body.l3Id),
    landlord_name: text(body.landlordName),
    landlord_status: text(body.landlordStatus),
    building_status: text(body.buildingStatus),
    floor: text(body.floor),
    agreement_value: parseAmount(body.agreementValue),
    lease_commencement_date: parseDMY(body.leaseCommencementDate),
    rent_commencement_date: parseDMY(body.rentCommencementDate),
    lease_end_date: parseDMY(body.leaseEndDate),
  };
  return { rec, raw };
}

// Rows touched by a status change: [{ statusType, oldStatus, newStatus }]
function statusChanges(before, after) {
  const changes = [];
  if (!before || before.landlord_status !== after.landlord_status) {
    changes.push({ statusType: 'Landlord', oldStatus: before?.landlord_status ?? null, newStatus: after.landlord_status });
  }
  if (!before || before.building_status !== after.building_status) {
    changes.push({ statusType: 'Building', oldStatus: before?.building_status ?? null, newStatus: after.building_status });
  }
  return changes;
}

module.exports = { SD_STATUSES, LABELS, DATE_FIELDS, blank, text, parseAmount, validateRecord, fromBody, statusChanges };
