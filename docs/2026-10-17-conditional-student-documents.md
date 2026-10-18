# Student residence document policy

Reviewed against official Göç İdaresi sources on 18 October 2026. The application policy in this change is versioned: submitted and older applications retain their existing policy snapshot and stored files; current drafts use the revised policy.

## Current application rules

- Both application types request the signed first page of the application form, passport identity/photo page and visa page if applicable, residence permit document-fee receipt, two biometric photos, student-status document, and address evidence for the selected accommodation.
- Renewal additionally requests the current residence registration document, one current utility bill or new subscription agreement for the registered address, and UETS for applicants aged 18 or older.
- Private health insurance and SGK/GSS are verified through the system and do not require a file upload. Students may select the three-month GSS application window. Applicants covered through a bilateral social security agreement must upload the provincial social-security evidence.
- Address evidence follows the official alternatives: notarized rental agreement; title deed plus numbering document; dormitory letter; hotel stay evidence plus payment receipt; or host notarized undertaking and address evidence. A married host also needs the spouse’s undertaking. The host identity copy is not requested. A host utility bill is not required for initial applications.
- Applicants under 18 first identify whether they entered with a student visa. Under the university’s stated policy, student-visa applicants are not asked for parental consent, a responsible-person undertaking, or conditional parent/family evidence. Applicants who entered visa-exempt or with another visa are asked for consent and the relevant family evidence; a parent's residence/work permit or application document remains optional when available.
- Residence-card upload is not requested.

## Official-source differences

The live student-specific “Documents Required” PDF currently lists the signed form, passport, fee, accommodation/address evidence, minor documents, insurance verification rules and extension address-registration documents. It does not list photographs, the student-status certificate or UETS. The student registration-form examples, however, list two biometric photos and the student-status certificate; the extension form also lists UETS for adults and says minors do not need it. The implementation follows those form examples for these items to avoid applicants arriving without documents named on the official form.

The student-specific PDF has no visible publication date or version number. The live initial and extension form examples show GöçNet version 2026/02 and dates 7–8 May 2026. They were reachable from the official e-İkamet site on 18 October 2026; this confirms the latest version exposed by those endpoints at review time, not that no later unpublished instruction exists. An older general PDF on the same site says four photos, while the current student form says two; this implementation uses two.

## Source links

- [Göç İdaresi student residence permit document list](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruIstenenBelgeler/BasvuruFormuIstenenBelgeler?tur=5)
- [Göç İdaresi student initial application form example](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruFormuOrnegi/BasvuruFormuBos?tur=5)
- [Göç İdaresi student extension form example](https://e-ikamet.goc.gov.tr/Ikamet/BasvuruFormuOrnegiUzatma/BasvuruFormuBos?tur=5)

## Implementation and validation

Current document applicability is enforced in the shared server policy and rechecked in D1 before upload/finalization. Migration `0025_conditional_student_documents.sql` preserves submitted applications under policy version 1 and applies the updated requirements to current drafts. Existing uploads are not deleted when their requirement becomes inapplicable.

Validation results are recorded after the 18 October 2026 policy update. Production deployment remains subject to the production backup/restore and rollback evidence gates; no production migration or deployment is implied by this document.
