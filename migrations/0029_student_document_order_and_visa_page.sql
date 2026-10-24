UPDATE document_requirements
SET display_order = CASE code
    WHEN 'residence_application_form' THEN 1
    WHEN 'passport' THEN 2
    WHEN 'visa' THEN 3
    WHEN 'photographs' THEN 4
    WHEN 'student_certificate' THEN 5
    WHEN 'health_insurance' THEN 6
    WHEN 'address_rental_contract' THEN 7
    WHEN 'address_residence_certificate' THEN 8
    WHEN 'address_undertaking' THEN 9
    WHEN 'host_residence_certificate' THEN 10
    WHEN 'home_utility_bill' THEN 11
    WHEN 'birth_certificate_under18' THEN 12
    WHEN 'address_title_deed' THEN 13
    WHEN 'address_numbering' THEN 14
    WHEN 'address_dormitory' THEN 15
    WHEN 'address_hotel' THEN 16
    WHEN 'address_hotel_receipt' THEN 17
    WHEN 'host_spouse_undertaking' THEN 18
    WHEN 'minor_consent' THEN 19
    WHEN 'minor_family_evidence' THEN 20
    WHEN 'parent_permit_copy' THEN 21
    WHEN 'uets' THEN 22
    WHEN 'residence_permit_fee' THEN 23
    ELSE display_order
END
WHERE application_type IN ('initial', 'renewal');

INSERT INTO document_requirements (id, code, application_type, is_required, display_order, is_active)
VALUES
    ('req-initial-visa-page', 'visa', 'initial', 0, 3, 1),
    ('req-renewal-visa-page', 'visa', 'renewal', 0, 3, 1);
