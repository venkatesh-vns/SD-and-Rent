-- Rent Agreement: new "Rent Other Charges" component (Rate / Month x %, from the RCD),
-- like "Rent to Landlord - Solar". Usable in Rule Master, Waiver Master and Rent Schedule.
ALTER TABLE rent_agreement_components DROP CONSTRAINT IF EXISTS rent_agreement_components_component_code_check;
ALTER TABLE rent_agreement_components ADD CONSTRAINT rent_agreement_components_component_code_check
    CHECK (component_code IN (
        'ADDITIONAL_PARKING', 'FITOUTS', 'CAFE', 'CAR_PARK', 'OFFICE',
        'SIGNAGE', 'SOLAR', 'TERRACE', 'MAINTENANCE', 'OTHER_CHARGES'));
