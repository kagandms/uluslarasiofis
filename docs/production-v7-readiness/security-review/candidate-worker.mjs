//#region src/server/domain/errors.js
var ApplicationConflictError = class extends Error {
	constructor(code = "APPLICATION_ALREADY_ACTIVE", message = "An active application already exists for this student.") {
		super(message);
		this.name = "ApplicationConflictError";
		this.code = code;
	}
};
var ApplicationTypeChangeBlockedError = class extends Error {
	constructor() {
		super("An existing document requirement cannot be mapped safely to the requested application type.");
		this.name = "ApplicationTypeChangeBlockedError";
		this.code = "APPLICATION_TYPE_CHANGE_BLOCKED";
	}
};
var RepositoryConfigurationError = class extends Error {
	constructor() {
		super("A required repository binding is unavailable.");
		this.name = "RepositoryConfigurationError";
		this.code = "REPOSITORY_CONFIGURATION_ERROR";
	}
};
var ApiError = class extends Error {
	constructor(status, code, message, retryable = false) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.retryable = retryable;
	}
};
//#endregion
//#region src/config/constants.js
var CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION = "contact-reachability-v1";
//#endregion
//#region src/server/repositories/d1/studentRepository.js
/**
* Normalizes a student number for case-insensitive identity checks.
* @param {string} studentNumber Student number supplied at the API boundary.
* @returns {string} Trimmed uppercase student number.
* @throws {TypeError} When the student number is empty or too long.
*/
function normalizeStudentNumber(studentNumber) {
	if (typeof studentNumber !== "string") throw new TypeError("Student number must be text.");
	const normalizedStudentNumber = studentNumber.trim().toLocaleUpperCase("en-US");
	if (normalizedStudentNumber.length === 0 || normalizedStudentNumber.length > 64) throw new TypeError("Student number must contain between 1 and 64 characters.");
	return normalizedStudentNumber;
}
/**
* Creates the student identity repository for one D1 binding.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {{findById(id: string): Promise<object|null>, findByStudentNumber(studentNumber: string): Promise<object|null>}}
*/
function createStudentRepository(database) {
	return Object.freeze({
		async findById(id) {
			return database.prepare("SELECT * FROM students WHERE id = ?").bind(id).first();
		},
		async findByStudentNumber(studentNumber) {
			const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
			return database.prepare("SELECT * FROM students WHERE normalized_student_number = ?").bind(normalizedStudentNumber).first();
		}
	});
}
//#endregion
//#region src/server/domain/documentPolicy.js
var MEDIA_TYPES = Object.freeze([
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp"
]);
var MAX_DOCUMENT_BYTES = 10485760;
var APPLICATION_TYPES$1 = Object.freeze(["initial", "renewal"]);
var TYPE_SWITCH_CODE_MAP = Object.freeze({
	residence_application_form: "residence_application_form",
	passport_identity: "passport_identity",
	passport: "passport",
	residence_card: "residence_card",
	photographs: "photographs",
	health_insurance: "health_insurance",
	uets: "uets",
	student_certificate: "student_certificate",
	residence_permit_fee: "residence_permit_fee",
	address_document: "address_document",
	address_rental_contract: "address_rental_contract",
	address_residence_certificate: "address_residence_certificate",
	address_undertaking: "address_undertaking",
	host_residence_certificate: "host_residence_certificate",
	host_identity_copy: "host_identity_copy",
	fingerprint: "fingerprint",
	home_utility_bill: "home_utility_bill",
	birth_certificate_under18: "birth_certificate_under18"
});
var POLICIES = Object.freeze([
	{
		code: "residence_application_form",
		order: 1,
		label: "documentResidenceApplicationForm",
		help: "documentResidenceApplicationFormHelp"
	},
	{
		code: "passport",
		order: 2,
		label: "documentPassport",
		help: "documentPassportHelp"
	},
	{
		code: "residence_card",
		order: 3,
		label: "documentResidenceCard",
		help: "documentResidenceCardHelp"
	},
	{
		code: "photographs",
		order: 4,
		label: "documentPhotographs",
		help: "documentPhotographsHelp"
	},
	{
		code: "health_insurance",
		order: 5,
		label: "documentHealthInsurance",
		help: "documentHealthInsuranceHelp"
	},
	{
		code: "uets",
		order: 6,
		label: "documentUets",
		help: "documentUetsHelp",
		application_types: ["renewal"]
	},
	{
		code: "student_certificate",
		order: 7,
		label: "documentStudentCertificate",
		help: "documentStudentCertificateHelp"
	},
	{
		code: "residence_permit_fee",
		order: 8,
		label: "documentResidencePermitFee",
		help: "documentResidencePermitFeeHelp"
	},
	{
		code: "address_rental_contract",
		order: 9,
		label: "documentAddressRentalContract",
		help: "documentAddressRentalContractHelp",
		address_evidence_type: "rental_contract"
	},
	{
		code: "address_residence_certificate",
		order: 10,
		label: "documentAddressResidenceCertificate",
		help: "documentAddressResidenceCertificateHelp",
		address_evidence_type: "residence_certificate"
	},
	{
		code: "address_undertaking",
		order: 11,
		label: "documentAddressUndertaking",
		help: "documentAddressUndertakingHelp",
		address_evidence_type: "undertaking"
	},
	{
		code: "host_residence_certificate",
		order: 12,
		label: "documentHostResidenceCertificate",
		help: "documentHostResidenceCertificateHelp",
		address_evidence_type: "undertaking",
		parent_code: "address_undertaking",
		accepted_media_types: ["application/pdf"]
	},
	{
		code: "host_identity_copy",
		order: 13,
		label: "documentHostIdentityCopy",
		help: "documentHostIdentityCopyHelp",
		address_evidence_type: "undertaking",
		parent_code: "address_undertaking"
	},
	{
		code: "home_utility_bill",
		order: 14,
		label: "documentHomeUtilityBill",
		help: "documentHomeUtilityBillHelp"
	},
	{
		code: "birth_certificate_under18",
		order: 15,
		label: "documentBirthCertificateUnder18",
		help: "documentBirthCertificateUnder18Help",
		conditional_rule: "under18"
	}
].map((policy) => Object.freeze({
	code: policy.code,
	application_types: Object.freeze([...policy.application_types || APPLICATION_TYPES$1]),
	required: true,
	display_order: policy.order,
	label_key: policy.label,
	description_key: policy.help,
	accepted_media_types: Object.freeze([...policy.accepted_media_types || MEDIA_TYPES]),
	max_byte_size: MAX_DOCUMENT_BYTES,
	active: true,
	conditional_rule: policy.conditional_rule || (policy.address_evidence_type ? `address_evidence:${policy.address_evidence_type}` : null),
	address_evidence_type: policy.address_evidence_type || null,
	parent_code: policy.parent_code || null
})));
function isPolicyApplicable(policy, applicationType, isUnder18, addressEvidenceType) {
	if (!policy.active || !policy.application_types.includes(applicationType)) return false;
	if (policy.conditional_rule === "under18" && !isUnder18) return false;
	return !policy.address_evidence_type || policy.address_evidence_type === addressEvidenceType;
}
function createStudentPolicyDto(policy) {
	return {
		code: policy.code,
		required: policy.required,
		display_order: policy.display_order,
		label_key: policy.label_key,
		description_key: policy.description_key,
		accepted_media_types: [...policy.accepted_media_types],
		max_byte_size: policy.max_byte_size,
		conditional_rule: policy.conditional_rule
	};
}
/**
* Returns the server-owned policy for one code when it applies to the current application.
* @param {string} code Stable public document code.
* @param {string} applicationType Application type loaded from the owner's D1 record.
* @param {boolean} isUnder18 Server-calculated age condition.
* @param {string|null} addressEvidenceType Persisted address evidence choice.
* @returns {object|null} Safe policy metadata source, or null when inapplicable.
*/
function readDocumentPolicy(code, applicationType, isUnder18, addressEvidenceType = null) {
	const policy = POLICIES.find((entry) => entry.code === code);
	return policy && isPolicyApplicable(policy, applicationType, isUnder18, addressEvidenceType) ? createStudentPolicyDto(policy) : null;
}
/**
* Lists safe document policies in product-defined order for the current application.
* @param {string} applicationType Application type loaded from D1.
* @param {boolean} isUnder18 Server-calculated age condition.
* @param {string|null} addressEvidenceType Persisted address evidence choice.
* @returns {Array<object>} Safe student policy metadata.
*/
function listDocumentPolicies(applicationType, isUnder18, addressEvidenceType = null) {
	return POLICIES.filter((policy) => isPolicyApplicable(policy, applicationType, isUnder18, addressEvidenceType)).sort((left, right) => left.display_order - right.display_order).map(createStudentPolicyDto);
}
/**
* Resolves a known stable document code to its same-code target for draft type switching.
* @param {string} code Existing requirement code on a draft document record.
* @returns {string|null} Explicit target code, or null for an unknown historical code.
*/
function mapDocumentRequirementCodeForTypeSwitch(code) {
	return typeof code === "string" && Object.hasOwn(TYPE_SWITCH_CODE_MAP, code) ? TYPE_SWITCH_CODE_MAP[code] : null;
}
//#endregion
//#region src/server/repositories/d1/application-access-statements.js
/**
* Fences code rotation, audit and revocation in the same transaction against current version/session authority.
* @param {D1Database} database D1 binding.
* @param {object} input Exact application, observed code version and authenticated actor.
* @returns {D1PreparedStatement[]} Atomic rotation statements.
* @throws {TypeError} Invalid trusted repository input.
*/
function createAccessCodeRotationStatements(database, input) {
	if (!Number.isSafeInteger(input.expectedAccessCodeVersion) || input.expectedAccessCodeVersion < 1 || !["student", "staff"].includes(input.actorType)) throw new TypeError("Code rotation requires current version and actor.");
	return [
		database.prepare(`UPDATE applications SET access_code_hash=?,access_code_created_at=?,access_code_version=access_code_version+1,
            updated_at=?,last_activity_at=? WHERE id=? AND access_code_version=? AND status NOT IN ('completed','cancelled','rejected')
            AND (?='staff' OR EXISTS (SELECT 1 FROM application_sessions WHERE id=? AND application_id=applications.id
                AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).bind(input.accessCodeHash, input.accessCodeCreatedAt, input.accessCodeCreatedAt, input.accessCodeCreatedAt, input.applicationId, input.expectedAccessCodeVersion, input.actorType, input.ownerSessionId || null),
		database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,application_id,request_id,safe_metadata_json,created_at)
            SELECT ?,?,?,?,?,?,'{"accessCodeRotated":true}',? WHERE changes()=1`).bind(input.auditEventId, input.actorType === "staff" ? "staff.application_access_code_reset" : "application.access_code_regenerated", input.actorType, input.actorStaffId || null, input.applicationId, input.requestId, input.accessCodeCreatedAt),
		database.prepare(`UPDATE application_sessions SET revoked_at=? WHERE application_id=? AND revoked_at IS NULL
            AND ?='staff' AND changes()=1`).bind(input.accessCodeCreatedAt, input.applicationId, input.actorType)
	];
}
//#endregion
//#region src/server/repositories/d1/application-owner-guard.js
/**
* Keeps a draft writer authorized at commit after a concurrent staff reset/logout.
* Bind the trusted owner session ID twice. Internal repository callers may omit it;
* public draft routes always supply the authenticated server session ID.
*/
var APPLICATION_OWNER_GUARD = `(? IS NULL OR EXISTS (
    SELECT 1 FROM application_sessions AS owner
    WHERE owner.id=? AND owner.application_id=applications.id AND owner.revoked_at IS NULL
      AND datetime(owner.expires_at)>datetime('now')
))`;
//#endregion
//#region src/server/auth/applicationAccessCode.js
var REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
var REFERENCE_PATTERN = /^ITU-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/i;
var encoder$3 = new TextEncoder();
/**
* Normalizes an application reference number.
* @param {string} reference Raw user input.
* @returns {string} Normalized uppercase reference.
*/
function normalizeApplicationReference(reference) {
	if (typeof reference !== "string") return "";
	return reference.trim().toUpperCase();
}
/**
* Checks if a string conforms to the application reference format.
* Format: ITU-XXXX-XXXX (where X is from unconfusable alphanumeric set).
* @param {string} reference Candidate string.
* @returns {boolean} True if format matches.
*/
function isValidApplicationReference(reference) {
	if (typeof reference !== "string") return false;
	return REFERENCE_PATTERN.test(reference.trim());
}
/**
* Generates a unique, non-guessable, format-compliant application reference.
* Not derived from any personal data (student number, passport, etc.).
* Exact entropy: 31^8 ≈ 8.5289 * 10^11 combinations (8 * log2(31) ≈ 39.63 bits).
* Uses rejection sampling (byte < 248, 248 = 31 * 8) to ensure zero modulo bias.
* @returns {string} Formatted reference, e.g. "ITU-7K9M-4X2P".
*/
function generateApplicationReference() {
	let part1 = "";
	let part2 = "";
	while (part1.length < 4 || part2.length < 4) {
		const bytes = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
		for (let i = 0; i < bytes.length; i++) {
			const byte = bytes[i];
			if (byte < 248) {
				const char = REFERENCE_ALPHABET[byte % 31];
				if (part1.length < 4) part1 += char;
				else if (part2.length < 4) part2 += char;
				else break;
			}
		}
	}
	return `ITU-${part1}-${part2}`;
}
/**
* Performs a constant-time comparison of two hex hashes to prevent timing attacks.
* @param {string} hashA First hex string.
* @param {string} hashB Second hex string.
* @returns {boolean} True if identical.
*/
function constantTimeCompare(hashA, hashB) {
	if (typeof hashA !== "string" || typeof hashB !== "string") return false;
	if (hashA.length !== hashB.length) return false;
	const bufA = encoder$3.encode(hashA);
	const bufB = encoder$3.encode(hashB);
	if (typeof crypto?.subtle?.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(bufA, bufB);
	let mismatch = 0;
	for (let i = 0; i < bufA.length; i++) mismatch |= bufA[i] ^ bufB[i];
	return mismatch === 0;
}
var ACCESS_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function generateAccessCode() {
	const bytes = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(26));
	const chars = [];
	for (let i = 0; i < 26; i++) chars.push(ACCESS_CODE_ALPHABET[bytes[i] & 31]);
	return [
		chars.slice(0, 5).join(""),
		chars.slice(5, 10).join(""),
		chars.slice(10, 15).join(""),
		chars.slice(15, 20).join(""),
		chars.slice(20, 26).join("")
	].join("-");
}
function normalizeAccessCode(code) {
	if (typeof code !== "string") return "";
	return code.trim().toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "");
}
function isValidAccessCodeFormat(code) {
	if (typeof code !== "string") return false;
	const normalized = normalizeAccessCode(code);
	return normalized.length === 26 && /^[2-9A-HJ-NP-Z]{26}$/.test(normalized);
}
async function hashAccessCode(code) {
	const normalized = normalizeAccessCode(code);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder$3.encode(normalized)));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function verifyAccessCode(submittedCode, storedHash) {
	if (!submittedCode || !storedHash) return false;
	return constantTimeCompare(await hashAccessCode(submittedCode), storedHash);
}
//#endregion
//#region src/server/repositories/d1/applicationRepository.js
var PUBLIC_APPLICATION_FIELDS = Object.freeze({
	applicationType: "application_type",
	addressEvidenceType: "address_evidence_type",
	studentEmail: "student_email",
	studentPhone: "student_phone",
	firstName: "first_name",
	lastName: "last_name",
	passportNumber: "passport_number",
	nationality: "nationality",
	dateOfBirth: "date_of_birth",
	isUnder18: "is_under_18",
	fingerprintStatus: "fingerprint_status",
	fingerprintCode: "fingerprint_code",
	declarationVersion: "declaration_version",
	declarationAcceptedAt: "declaration_accepted_at"
});
function isActiveApplicationConflict(error) {
	return /unique constraint failed: applications\.student_id/i.test(String(error?.message));
}
function isReferenceConflict(error) {
	return /unique constraint failed: (applications\.)?reference_number/i.test(String(error?.message));
}
/**
* Creates the application repository for one D1 binding.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {object} Repository operations for application records.
*/
function createApplicationRepository(database) {
	return Object.freeze({
		async createDraft({ applicationId, studentId, studentNumber, applicationType, studentEmail, studentPhone }) {
			const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
			const statements = [database.prepare(`
                    INSERT INTO students (id, student_number, normalized_student_number)
                    VALUES (?, ?, ?)
                    ON CONFLICT(normalized_student_number) DO NOTHING
                `).bind(studentId, studentNumber.trim(), normalizedStudentNumber), database.prepare(`
                    INSERT INTO applications (
                        id, student_id, application_type, student_email, student_phone, retention_due_at
                    )
                    SELECT ?, id, ?, ?, ?, datetime('now', '+30 days')
                    FROM students WHERE normalized_student_number = ?
                `).bind(applicationId, applicationType, studentEmail, studentPhone, normalizedStudentNumber)];
			try {
				if ((await database.batch(statements))[1]?.meta?.changes !== 1) throw new Error("Application insert did not create a row.");
			} catch (error) {
				if (isActiveApplicationConflict(error)) throw new ApplicationConflictError();
				throw error;
			}
			return this.findById(applicationId);
		},
		async createDraftWithSession({ applicationId, studentId, studentNumber, applicationType, studentEmail, studentPhone, sessionId, tokenHash, expiresAt, createdAt, auditEventId, requestId, referenceNumber = null, accessCodeHash = null }) {
			const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
			const maxRetries = referenceNumber ? 1 : 5;
			for (let attempt = 0; attempt < maxRetries; attempt++) {
				const finalReference = referenceNumber || generateApplicationReference();
				const statements = [
					database.prepare(`
                        INSERT INTO students (id, student_number, normalized_student_number)
                        VALUES (?, ?, ?)
                        ON CONFLICT(normalized_student_number) DO NOTHING
                    `).bind(studentId, studentNumber.trim(), normalizedStudentNumber),
					database.prepare(`
                        INSERT INTO applications (
                            id, student_id, reference_number, access_code_hash, access_code_created_at,
                            access_code_version, lock_version, application_type, student_email, student_phone, retention_due_at
                        )
                        SELECT ?, id, ?, ?, ?, 1, 1, ?, ?, ?, datetime(?, '+30 days')
                        FROM students WHERE normalized_student_number = ?
                    `).bind(applicationId, finalReference, accessCodeHash, createdAt, applicationType, studentEmail, studentPhone, createdAt, normalizedStudentNumber),
					database.prepare(`
                        INSERT INTO application_sessions (id, application_id, token_hash, expires_at, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    `).bind(sessionId, applicationId, tokenHash, expiresAt, createdAt),
					database.prepare(`
                        INSERT INTO audit_events (id, event_type, actor_type, application_id, request_id, safe_metadata_json)
                        SELECT ?, 'application.draft_created', 'student', ?, ?, '{}'
                        WHERE EXISTS (SELECT 1 FROM applications WHERE id = ?)
                    `).bind(auditEventId, applicationId, requestId, applicationId)
				];
				try {
					const results = await database.batch(statements);
					if (results[1]?.meta?.changes !== 1 || results[2]?.meta?.changes !== 1 || results[3]?.meta?.changes !== 1) throw new Error("Application, session, and audit transaction did not complete.");
					return this.findById(applicationId);
				} catch (error) {
					if (isActiveApplicationConflict(error)) throw new ApplicationConflictError();
					if (isReferenceConflict(error) && !referenceNumber && attempt < maxRetries - 1) continue;
					throw error;
				}
			}
		},
		async findByReferenceNumber(referenceNumber) {
			if (!referenceNumber) return null;
			const normalizedRef = referenceNumber.trim().toUpperCase();
			return database.prepare(`
                SELECT applications.*, students.student_number,
                    EXISTS (
                        SELECT 1 FROM audit_events
                        WHERE audit_events.application_id = applications.id
                          AND audit_events.event_type = 'application.contact_responsibility_accepted'
                          AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
                    ) AS contact_acknowledgement_accepted_current,
                    (
                        SELECT audit_events.created_at FROM audit_events
                        WHERE audit_events.application_id = applications.id
                          AND audit_events.event_type = 'application.contact_responsibility_accepted'
                          AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
                        ORDER BY audit_events.created_at DESC LIMIT 1
                    ) AS contact_acknowledgement_accepted_at
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE UPPER(applications.reference_number) = ?
            `).bind(CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, normalizedRef).first();
		},
		async updateAccessCode(input) {
			if ((await database.batch(createAccessCodeRotationStatements(database, input)))[0]?.meta?.changes !== 1) return null;
			return this.findById(input.applicationId);
		},
		async findById(applicationId) {
			return database.prepare(`
                SELECT applications.*, students.student_number,
                    EXISTS (
                        SELECT 1 FROM audit_events
                        WHERE audit_events.application_id = applications.id
                          AND audit_events.event_type = 'application.contact_responsibility_accepted'
                          AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
                    ) AS contact_acknowledgement_accepted_current,
                    (
                        SELECT audit_events.created_at FROM audit_events
                        WHERE audit_events.application_id = applications.id
                          AND audit_events.event_type = 'application.contact_responsibility_accepted'
                          AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
                        ORDER BY audit_events.created_at DESC LIMIT 1
                    ) AS contact_acknowledgement_accepted_at
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE applications.id = ?
            `).bind(CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, applicationId).first();
		},
		async findTrackableByStudentNumber(studentNumber) {
			const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
			const selected = await database.prepare(`
                SELECT applications.id
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE students.normalized_student_number = ?
                  AND applications.status <> 'draft'
                  AND NOT EXISTS (
                      SELECT 1 FROM application_deletions
                      WHERE application_deletions.application_id = applications.id
                  )
                ORDER BY
                    CASE WHEN applications.status IN ('completed', 'cancelled', 'rejected') THEN 1 ELSE 0 END,
                    applications.updated_at DESC,
                    applications.created_at DESC,
                    applications.id DESC
                LIMIT 1
            `).bind(normalizedStudentNumber).first();
			if (!selected) return null;
			return this.findById(selected.id);
		},
		async queryStaffApplications({ statuses, isDeleted = false, includeDeleted = false, searchPattern, pageSize, offset }) {
			const conditions = ["applications.status <> 'draft'"];
			const queryValues = [];
			const deletedClause = "EXISTS (SELECT 1 FROM application_deletions WHERE application_id=applications.id AND state IN ('soft_deleted','purge_pending'))";
			if (includeDeleted && statuses?.length) {
				conditions.push(`((applications.status IN (${statuses.map(() => "?").join(", ")}) AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id=applications.id)) OR ${deletedClause})`);
				queryValues.push(...statuses);
			} else if (isDeleted) conditions.push(deletedClause);
			else conditions.push("NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id=applications.id)");
			if (statuses?.length && !includeDeleted) {
				conditions.push(`applications.status IN (${statuses.map(() => "?").join(", ")})`);
				queryValues.push(...statuses);
			}
			if (searchPattern) {
				conditions.push(`(
                    students.student_number LIKE ? ESCAPE '\\'
                    OR COALESCE(applications.first_name, '') LIKE ? ESCAPE '\\'
                    OR COALESCE(applications.last_name, '') LIKE ? ESCAPE '\\'
                    OR (COALESCE(applications.first_name, '') || ' ' || COALESCE(applications.last_name, '')) LIKE ? ESCAPE '\\'
                    OR (COALESCE(applications.last_name, '') || ' ' || COALESCE(applications.first_name, '')) LIKE ? ESCAPE '\\'
                    OR COALESCE(applications.passport_number, '') LIKE ? ESCAPE '\\'
                )`);
				queryValues.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
			}
			const whereClause = conditions.join(" AND ");
			const [countResult, pageResult] = await Promise.all([database.prepare(`
                    SELECT COUNT(*) AS total_items
                    FROM applications
                    JOIN students ON students.id = applications.student_id
                    WHERE ${whereClause}
                `).bind(...queryValues).first(), database.prepare(`
                    SELECT applications.id, students.student_number, applications.first_name,
                           applications.last_name, applications.application_type, applications.status,
                           applications.submitted_at, applications.updated_at,
                           application_deletions.state AS deletion_state
                    FROM applications
                    JOIN students ON students.id = applications.student_id
                    LEFT JOIN application_deletions ON application_deletions.application_id=applications.id
                    WHERE ${whereClause}
                    ORDER BY applications.updated_at DESC, applications.created_at DESC, applications.id DESC
                    LIMIT ? OFFSET ?
                `).bind(...queryValues, pageSize, offset).all()]);
			return {
				totalItems: countResult.total_items,
				items: pageResult.results
			};
		},
		async acceptContactResponsibilityAcknowledgement({ applicationId, version, acceptedAt, requestId }) {
			const eventId = `${applicationId}:contact-responsibility:${version}`;
			await database.prepare(`
                INSERT OR IGNORE INTO audit_events (
                    id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at
                )
                SELECT ?, 'application.contact_responsibility_accepted', 'student', ?, ?, json_object('version', ?), ?
                WHERE EXISTS (
                    SELECT 1 FROM applications
                    WHERE id = ? AND status = 'draft'
                      AND length(trim(COALESCE(student_email, ''))) > 0
                      AND length(trim(COALESCE(student_phone, ''))) > 0
                )
            `).bind(eventId, applicationId, requestId, version, acceptedAt, applicationId).run();
			return await database.prepare(`
                SELECT id FROM audit_events
                WHERE id = ? AND application_id = ?
                  AND event_type = 'application.contact_responsibility_accepted'
            `).bind(eventId, applicationId).first() ? this.findById(applicationId) : null;
		},
		async findCurrentStatusById(applicationId) {
			return database.prepare(`
                SELECT status, application_type, updated_at
                FROM applications
                WHERE id = ?
            `).bind(applicationId).first();
		},
		async submitDraft({ applicationId, submittedAt, auditEventId, requestId }) {
			const results = await database.batch([database.prepare(`
                    UPDATE applications
                    SET status = 'submitted', submitted_at = ?, updated_at = ?, last_activity_at = ?,
                        terminal_at = NULL, retention_due_at = NULL
                    WHERE id = ? AND status = 'draft'
                `).bind(submittedAt, submittedAt, submittedAt, applicationId), database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at
                    ) SELECT ?, 'application.submitted', 'student', ?, ?, '{"applicationStatus":"submitted"}', ?
                    WHERE changes() = 1
                `).bind(auditEventId, applicationId, requestId, submittedAt)]);
			if (results[0]?.meta?.changes !== 1) return null;
			if (results[1]?.meta?.changes !== 1) throw new Error("Application submit audit did not complete.");
			return this.findById(applicationId);
		},
		async acceptDeclaration({ applicationId, version, acceptedAt, auditEventId, requestId }) {
			const results = await database.batch([database.prepare(`
                    UPDATE applications
                    SET declaration_version = ?, declaration_accepted_at = ?,
                        updated_at = ?, last_activity_at = ?
                    WHERE id = ? AND status = 'draft'
                `).bind(version, acceptedAt, acceptedAt, acceptedAt, applicationId), database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at
                    ) SELECT ?, 'application.declaration_accepted', 'student', ?, ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditEventId, applicationId, requestId, JSON.stringify({ version }), acceptedAt)]);
			if (results[0]?.meta?.changes !== 1) return null;
			if (results[1]?.meta?.changes !== 1) throw new Error("Declaration acceptance audit did not complete.");
			return this.findById(applicationId);
		},
		async findActiveByStudentNumber(studentNumber) {
			const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
			return database.prepare(`
                SELECT applications.id, applications.status, applications.application_type
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE students.normalized_student_number = ?
                  AND applications.status NOT IN ('completed', 'cancelled', 'rejected')
                LIMIT 1
            `).bind(normalizedStudentNumber).first();
		},
		async updateDraft(applicationId, changes, auditContext = null, expectedLockVersion = null) {
			const fields = Object.entries(changes).filter(([key]) => Object.hasOwn(PUBLIC_APPLICATION_FIELDS, key));
			if (fields.length === 0) return this.findById(applicationId);
			const requestedType = changes.applicationType;
			const ownerSessionId = auditContext?.ownerSessionId || null;
			const writeAuthority = {
				expectedLockVersion,
				ownerSessionId
			};
			if (requestedType === void 0) return this.updateDraftFields(applicationId, fields, writeAuthority);
			const currentApplication = await this.findById(applicationId);
			if (!currentApplication || currentApplication.status !== "draft") return null;
			if (expectedLockVersion !== null && expectedLockVersion !== void 0 && currentApplication.lock_version !== expectedLockVersion) throw new ApplicationConflictError("APPLICATION_UPDATE_CONFLICT");
			if (requestedType === currentApplication.application_type) return this.updateDraftFields(applicationId, fields.filter(([key]) => key !== "applicationType"), writeAuthority);
			if (!auditContext?.auditEventId || !auditContext?.requestId) throw new TypeError("Application type changes require audit context.");
			const remaps = await this.readDocumentRequirementRemaps(applicationId, requestedType);
			const assignments = fields.map(([key]) => `${PUBLIC_APPLICATION_FIELDS[key]} = ?`);
			assignments.push("lock_version = lock_version + 1");
			const values = fields.map(([, value]) => value);
			const applicationUpdateIndex = remaps.length + 1;
			const statements = [database.prepare("PRAGMA defer_foreign_keys = ON")];
			remaps.forEach((remap) => statements.push(database.prepare(`
                UPDATE document_records
                SET requirement_id = ?, application_type = ?
                WHERE id = ? AND application_id = ?
                  AND requirement_id = ? AND application_type = ?
                  AND EXISTS (SELECT 1 FROM applications WHERE id=? AND status='draft'
                    AND (? IS NULL OR lock_version=?) AND ${APPLICATION_OWNER_GUARD})
            `).bind(remap.targetRequirementId, requestedType, remap.recordId, applicationId, remap.currentRequirementId, currentApplication.application_type, applicationId, expectedLockVersion, expectedLockVersion, ownerSessionId, ownerSessionId)));
			statements.push(database.prepare(`
                UPDATE applications
                SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP,
                    last_activity_at = CURRENT_TIMESTAMP,
                    retention_due_at = datetime('now', '+30 days')
                WHERE id = ? AND status = 'draft' AND application_type = ?
                  AND (? IS NULL OR lock_version=?)
                  AND ${APPLICATION_OWNER_GUARD}
                  AND (SELECT COUNT(*) FROM document_records WHERE application_id = ?) = ?
                  AND NOT EXISTS (
                      SELECT 1 FROM document_records AS records
                      JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                      WHERE records.application_id = ?
                        AND (records.application_type <> ? OR requirements.application_type <> ?)
                  )
            `).bind(...values, applicationId, currentApplication.application_type, expectedLockVersion, expectedLockVersion, ownerSessionId, ownerSessionId, applicationId, remaps.length, applicationId, requestedType, requestedType));
			statements.push(database.prepare(`
                INSERT INTO audit_events (
                    id, event_type, actor_type, application_id, request_id, safe_metadata_json
                ) SELECT ?, 'application.application_type_changed', 'student', ?, ?, ?
                WHERE changes() = 1
            `).bind(auditContext.auditEventId, applicationId, auditContext.requestId, JSON.stringify({
				previous_application_type: currentApplication.application_type,
				new_application_type: requestedType
			})));
			const results = await database.batch(statements);
			if (results[applicationUpdateIndex]?.meta?.changes !== 1 && expectedLockVersion !== null) throw new ApplicationConflictError("APPLICATION_UPDATE_CONFLICT");
			if (results[applicationUpdateIndex]?.meta?.changes !== 1) return null;
			if (results[applicationUpdateIndex + 1]?.meta?.changes !== 1) throw new Error("Application type change audit did not complete.");
			return this.findById(applicationId);
		},
		async updateDraftFields(applicationId, fields, { expectedLockVersion = null, ownerSessionId = null } = {}) {
			if (fields.length === 0) return this.findById(applicationId);
			const assignments = fields.map(([key]) => `${PUBLIC_APPLICATION_FIELDS[key]} = ?`);
			assignments.push("lock_version = lock_version + 1");
			const values = fields.map(([, value]) => value);
			let whereClause = `id = ? AND status = 'draft' AND ${APPLICATION_OWNER_GUARD}`;
			const whereValues = [
				applicationId,
				ownerSessionId,
				ownerSessionId
			];
			if (expectedLockVersion !== null && expectedLockVersion !== void 0) {
				whereClause += " AND lock_version = ?";
				whereValues.push(expectedLockVersion);
			}
			const result = await database.prepare(`
                UPDATE applications
                SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP,
                    last_activity_at = CURRENT_TIMESTAMP,
                    retention_due_at = datetime('now', '+30 days')
                WHERE ${whereClause}
            `).bind(...values, ...whereValues).run();
			if (result.meta.changes === 0 && expectedLockVersion !== null && expectedLockVersion !== void 0) throw new ApplicationConflictError("APPLICATION_UPDATE_CONFLICT");
			return result.meta.changes === 1 ? this.findById(applicationId) : null;
		},
		async changeDraftStudentNumber({ applicationId, studentId, studentNumber, expectedLockVersion = null, ownerSessionId = null }) {
			const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
			const current = await this.findById(applicationId);
			if (!current || current.status !== "draft") return null;
			if (expectedLockVersion !== null && expectedLockVersion !== void 0 && current.lock_version !== expectedLockVersion) throw new ApplicationConflictError("APPLICATION_UPDATE_CONFLICT");
			const oldStudent = await database.prepare("SELECT id FROM students WHERE id = (SELECT student_id FROM applications WHERE id = ?)").bind(applicationId).first();
			let lockClause = "";
			const lockValues = [];
			if (expectedLockVersion !== null && expectedLockVersion !== void 0) {
				lockClause = " AND lock_version = ?";
				lockValues.push(expectedLockVersion);
			}
			const statements = [database.prepare(`
                    INSERT INTO students (id, student_number, normalized_student_number)
                    VALUES (?, ?, ?)
                    ON CONFLICT(normalized_student_number) DO NOTHING
                `).bind(studentId, studentNumber.trim(), normalizedStudentNumber), database.prepare(`
                    UPDATE applications
                    SET student_id = (SELECT id FROM students WHERE normalized_student_number = ?),
                        lock_version = lock_version + 1, updated_at = CURRENT_TIMESTAMP,
                        last_activity_at = CURRENT_TIMESTAMP,
                        retention_due_at = datetime('now', '+30 days')
                    WHERE id = ? AND status = 'draft'${lockClause} AND ${APPLICATION_OWNER_GUARD}
                `).bind(normalizedStudentNumber, applicationId, ...lockValues, ownerSessionId, ownerSessionId)];
			if (oldStudent?.id) statements.push(database.prepare(`
                    DELETE FROM students
                    WHERE id = ? AND NOT EXISTS (SELECT 1 FROM applications WHERE student_id = students.id)
                `).bind(oldStudent.id));
			let results;
			try {
				results = await database.batch(statements);
			} catch (error) {
				if (isActiveApplicationConflict(error)) throw new ApplicationConflictError();
				throw error;
			}
			if (results[1]?.meta?.changes !== 1) {
				if (expectedLockVersion !== null && expectedLockVersion !== void 0) throw new ApplicationConflictError("APPLICATION_UPDATE_CONFLICT");
				return null;
			}
			return this.findById(applicationId);
		},
		async readDocumentRequirementRemaps(applicationId, targetApplicationType) {
			const records = await database.prepare(`
                SELECT records.id AS record_id, records.requirement_id, requirements.code
                FROM document_records AS records
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE records.application_id = ?
                ORDER BY records.id
            `).bind(applicationId).all();
			const remaps = [];
			for (const record of records.results) {
				const targetCode = mapDocumentRequirementCodeForTypeSwitch(record.code);
				if (!targetCode) throw new ApplicationTypeChangeBlockedError();
				const targetRequirement = await database.prepare(`
                    SELECT id, application_type FROM document_requirements
                    WHERE code = ? AND application_type = ?
                `).bind(targetCode, targetApplicationType).first();
				if (!targetRequirement || targetRequirement.application_type !== targetApplicationType) throw new ApplicationTypeChangeBlockedError();
				remaps.push({
					recordId: record.record_id,
					currentRequirementId: record.requirement_id,
					targetRequirementId: targetRequirement.id
				});
			}
			return remaps;
		},
		async listExpiredDrafts(cutoff, limit = 100) {
			const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
			return (await database.prepare(`
                SELECT id FROM applications
                WHERE status = 'draft'
                  AND COALESCE(retention_due_at, datetime(last_activity_at, '+30 days')) <= datetime(?)
                ORDER BY retention_due_at ASC LIMIT ?
            `).bind(cutoff, boundedLimit).all()).results;
		}
	});
}
//#endregion
//#region src/server/repositories/d1/applicationNoteRepository.js
/**
* Creates persistence operations for student-visible application messages.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {object} Narrow note lookup and transactional insert operations.
*/
function createApplicationNoteRepository(database) {
	return Object.freeze({
		async listLatestStudentDocumentMessages(applicationId) {
			const result = await database.prepare(`
                SELECT document_record_id, body
                FROM (
                    SELECT application_notes.document_record_id, application_notes.body,
                           ROW_NUMBER() OVER (
                               PARTITION BY application_notes.document_record_id
                               ORDER BY application_notes.created_at DESC, application_notes.id DESC
                           ) AS message_rank
                    FROM application_notes
                    JOIN document_records
                      ON document_records.id = application_notes.document_record_id
                     AND document_records.application_id = application_notes.application_id
                    WHERE application_notes.application_id = ? AND application_notes.visibility = 'student'
                      AND application_notes.document_record_id IS NOT NULL
                )
                WHERE message_rank = 1
            `).bind(applicationId).all();
			return new Map(result.results.map((message) => [message.document_record_id, message.body]));
		},
		prepareStudentDocumentMessage({ id, applicationId, documentRecordId, staffId, body, createdAt }) {
			return database.prepare(`
                INSERT INTO application_notes (
                    id, application_id, document_record_id, author_type,
                    author_staff_id, visibility, body, created_at
                )
                SELECT ?, ?, records.id, 'staff', ?, 'student', ?, ?
                FROM document_records AS records
                JOIN document_revisions AS revisions ON revisions.document_record_id = records.id
                WHERE records.id = ? AND records.application_id = ?
                  AND revisions.is_current = 1 AND revisions.status = 'resubmission_required'
            `).bind(id, applicationId, staffId, body, createdAt, documentRecordId, applicationId);
		}
	});
}
//#endregion
//#region src/server/repositories/d1/resubmission-review-target.js
/**
* Reads current finalized metadata for a reasoned replacement, without file access capabilities.
* @param {D1Database} database D1 binding.
* @param {{applicationId: string, code: string}} input Exact application and policy code.
* @returns {Promise<object|null>} Current revision facts; never an R2 key or signed URL.
* @throws {Error} When the database read fails.
*/
async function findCurrentResubmissionTarget(database, input) {
	return database.prepare(`
        SELECT records.id AS document_record_id, revisions.id AS revision_id,
               revisions.revision_number, revisions.status AS revision_status,
               records.review_status, files.scan_status, files.media_type
        FROM applications
        JOIN document_records AS records ON records.application_id = applications.id
        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
        JOIN document_revisions AS revisions ON revisions.document_record_id = records.id
        JOIN document_revision_files AS files ON files.revision_id = revisions.id AND files.page_order = 0
        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
        WHERE applications.id = ? AND applications.status IN ('under_review', 'resubmission_required')
          AND records.application_type = applications.application_type
          AND requirements.application_type = applications.application_type
          AND requirements.code = ? AND requirements.is_active = 1
          AND revisions.is_current = 1
          AND revisions.status IN ('submitted', 'approved', 'resubmission_required')
          AND files.upload_status = 'finalized' AND files.scan_status IN ('clean', 'unsafe', 'failed')
          AND files.cleanup_status = 'none' AND intents.status = 'completed'
        LIMIT 1
    `).bind(input.applicationId, input.code).first();
}
//#endregion
//#region src/server/repositories/d1/applicationReviewRepository.js
var MILLISECONDS_PER_DAY = 864e5;
function addUtcDays(timestamp, days) {
	const timestampMilliseconds = Date.parse(timestamp);
	if (!Number.isFinite(timestampMilliseconds)) throw new TypeError("Application timestamp must be valid.");
	return new Date(timestampMilliseconds + days * MILLISECONDS_PER_DAY).toISOString();
}
/**
* Creates atomic persistence operations for staff application and document review.
* @param {D1Database} database Cloudflare D1 binding.
* @param {object} notes Student-visible application note repository.
* @returns {object} Conditional, audit-coupled review mutations.
*/
function createApplicationReviewRepository(database, notes) {
	return Object.freeze({
		async findCurrentDocumentForResubmission(applicationId, code) {
			return findCurrentResubmissionTarget(database, {
				applicationId,
				code
			});
		},
		async transitionApplicationStatus({ applicationId, currentStatus, expectedUpdatedAt, targetStatus, staffId, now, requestId, auditId }) {
			const isCompleted = targetStatus === "completed";
			const terminalAt = isCompleted ? now : null;
			const retentionDueAt = isCompleted ? addUtcDays(now, 365) : null;
			const statements = [database.prepare(`
                    UPDATE applications SET status = ?, updated_at = ?, last_activity_at = ?,
                        terminal_at = ?, retention_due_at = ?
                    WHERE id = ? AND status = ? AND updated_at = ?
                `).bind(targetStatus, now, now, terminalAt, retentionDueAt, applicationId, currentStatus, expectedUpdatedAt), database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json
                    ) SELECT ?, ?, 'staff', ?, ?, ?, ? WHERE changes() = 1
                `).bind(auditId, targetStatus === "under_review" && currentStatus === "submitted" ? "staff.application_review_started" : "staff.application_status_changed", staffId, applicationId, requestId, JSON.stringify({
				applicationStatus: targetStatus,
				result: "success"
			}))];
			if (isCompleted) statements.push(database.prepare(`
                    UPDATE application_sessions SET revoked_at = ?
                    WHERE application_id = ? AND revoked_at IS NULL AND changes() = 1
                `).bind(now, applicationId));
			if (currentStatus === "completed") statements.push(database.prepare(`
                    UPDATE application_sessions SET revoked_at = NULL
                    WHERE application_id = ? AND changes() = 1
                `).bind(applicationId));
			const results = await database.batch(statements);
			return results[0]?.meta?.changes === 1 && results[1]?.meta?.changes === 1;
		},
		async approveCurrentDocument({ applicationId, documentRecordId, revisionId, revisionNumber, code, staffId, now, requestId, auditId }) {
			return (await database.batch([
				database.prepare(`
                    UPDATE document_revisions
                    SET status = 'approved', reviewed_at = ?, reviewed_by_staff_id = ?
                    WHERE id = ? AND document_record_id = ? AND revision_number = ?
                      AND is_current = 1 AND status = 'submitted'
                      AND EXISTS (
                        SELECT 1 FROM document_records AS records
                        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                        JOIN applications ON applications.id = records.application_id
                        JOIN document_revision_files AS files ON files.revision_id = document_revisions.id
                        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                        WHERE records.id = document_revisions.document_record_id
                          AND records.application_id = ? AND records.review_status IN ('pending', 'under_review')
                          AND applications.status IN ('under_review', 'resubmission_required')
                          AND requirements.is_active = 1 AND files.upload_status = 'finalized'
                          AND files.scan_status = 'clean' AND files.cleanup_status = 'none'
                          AND intents.status = 'completed'
                      )
                `).bind(now, staffId, revisionId, documentRecordId, revisionNumber, applicationId),
				database.prepare(`
                    UPDATE document_records SET review_status = 'approved', updated_at = ?
                    WHERE id = ? AND application_id = ? AND review_status IN ('pending', 'under_review')
                      AND changes() = 1 AND EXISTS (
                        SELECT 1 FROM document_revisions
                        WHERE id = ? AND document_record_id = document_records.id
                          AND is_current = 1 AND status = 'approved'
                      )
                `).bind(now, documentRecordId, applicationId, revisionId),
				database.prepare(`
                    UPDATE applications SET updated_at = ?, last_activity_at = ?
                    WHERE id = ? AND status IN ('under_review', 'resubmission_required') AND changes() = 1
                `).bind(now, now, applicationId),
				database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        document_record_id, request_id, safe_metadata_json
                    ) SELECT ?, 'staff.document_approved', 'staff', ?, ?, ?, ?, ? WHERE changes() = 1
                `).bind(auditId, staffId, applicationId, documentRecordId, requestId, JSON.stringify({
					documentCode: code,
					revisionNumber,
					documentStatus: "approved",
					result: "success"
				}))
			])).every((result) => result?.meta?.changes === 1);
		},
		async unapproveCurrentDocument({ applicationId, documentRecordId, revisionId, revisionNumber, code, staffId, now, requestId, auditId }) {
			return (await database.batch([
				database.prepare(`
                    UPDATE document_revisions SET status = 'submitted', reviewed_at = NULL, reviewed_by_staff_id = NULL
                    WHERE id = ? AND document_record_id = ? AND revision_number = ?
                      AND is_current = 1 AND status = 'approved'
                      AND EXISTS (
                        SELECT 1 FROM document_records AS records
                        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                        JOIN applications ON applications.id = records.application_id
                        JOIN document_revision_files AS files ON files.revision_id = document_revisions.id
                        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                        WHERE records.id = document_revisions.document_record_id
                          AND records.application_id = ? AND records.review_status = 'approved'
                          AND applications.status IN ('under_review', 'resubmission_required')
                          AND requirements.is_active = 1 AND files.upload_status = 'finalized'
                          AND files.scan_status = 'clean' AND files.cleanup_status = 'none'
                          AND intents.status = 'completed'
                      )
                `).bind(revisionId, documentRecordId, revisionNumber, applicationId),
				database.prepare(`
                    UPDATE document_records SET review_status = 'under_review', updated_at = ?
                    WHERE id = ? AND application_id = ? AND review_status = 'approved' AND changes() = 1
                      AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND document_record_id = document_records.id
                        AND is_current = 1 AND status = 'submitted')
                `).bind(now, documentRecordId, applicationId, revisionId),
				database.prepare(`
                    UPDATE applications SET updated_at = ?, last_activity_at = ?
                    WHERE id = ? AND status IN ('under_review', 'resubmission_required') AND changes() = 1
                `).bind(now, now, applicationId),
				database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        document_record_id, request_id, safe_metadata_json
                    ) SELECT ?, 'staff.document_unapproved', 'staff', ?, ?, ?, ?, ? WHERE changes() = 1
                `).bind(auditId, staffId, applicationId, documentRecordId, requestId, JSON.stringify({
					documentCode: code,
					revisionNumber,
					documentStatus: "under_review",
					result: "success"
				}))
			])).every((result) => result?.meta?.changes === 1);
		},
		async requestCurrentDocumentResubmission({ applicationId, documentRecordId, revisionId, revisionNumber, expectedScanStatus, code, staffId, reason, now, requestId, auditId, noteId }) {
			return (await database.batch([
				database.prepare(`
                    UPDATE document_revisions
                    SET status = 'resubmission_required', reviewed_at = ?, reviewed_by_staff_id = ?
                    WHERE id = ? AND document_record_id = ? AND revision_number = ?
                      AND is_current = 1 AND status = 'submitted'
                      AND EXISTS (
                        SELECT 1 FROM document_records AS records
                        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                        JOIN applications ON applications.id = records.application_id
                        JOIN document_revision_files AS files ON files.revision_id = document_revisions.id
                        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                        WHERE records.id = document_revisions.document_record_id
                          AND records.application_id = ? AND records.review_status IN ('pending', 'under_review')
                          AND applications.status IN ('under_review', 'resubmission_required')
                          AND requirements.is_active = 1 AND files.upload_status = 'finalized'
                          AND files.scan_status IN ('clean', 'unsafe', 'failed') AND files.scan_status = ?
                          AND files.cleanup_status = 'none'
                          AND intents.status = 'completed'
                      )
                `).bind(now, staffId, revisionId, documentRecordId, revisionNumber, applicationId, expectedScanStatus),
				database.prepare(`
                    UPDATE document_records SET review_status = 'resubmission_required', updated_at = ?
                    WHERE id = ? AND application_id = ? AND review_status IN ('pending', 'under_review')
                      AND changes() = 1 AND EXISTS (
                        SELECT 1 FROM document_revisions
                        WHERE id = ? AND document_record_id = document_records.id
                          AND is_current = 1 AND status = 'resubmission_required'
                      )
                `).bind(now, documentRecordId, applicationId, revisionId),
				database.prepare(`
                    UPDATE applications SET status = 'resubmission_required', updated_at = ?, last_activity_at = ?
                    WHERE id = ? AND status IN ('under_review', 'resubmission_required') AND changes() = 1
                `).bind(now, now, applicationId),
				notes.prepareStudentDocumentMessage({
					id: noteId,
					applicationId,
					documentRecordId,
					staffId,
					body: reason,
					createdAt: now
				}),
				database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        document_record_id, request_id, safe_metadata_json
                    ) SELECT ?, 'staff.document_resubmission_requested', 'staff', ?, ?, ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditId, staffId, applicationId, documentRecordId, requestId, JSON.stringify({
					documentCode: code,
					revisionNumber,
					documentStatus: "resubmission_required",
					applicationStatus: "resubmission_required",
					result: "success"
				}))
			])).every((result) => result?.meta?.changes === 1);
		}
	});
}
//#endregion
//#region src/server/repositories/d1/auditRepository.js
var SAFE_AUDIT_KEYS = /* @__PURE__ */ new Set([
	"role",
	"targetRole",
	"active",
	"changedFields",
	"applicationStatus",
	"documentStatus",
	"documentCode",
	"revisionNumber",
	"outboxId",
	"channel",
	"result",
	"retentionDays"
]);
function sanitizeAuditMetadata(metadata = {}) {
	return Object.fromEntries(Object.entries(metadata).filter(([key, value]) => SAFE_AUDIT_KEYS.has(key) && [
		"string",
		"number",
		"boolean"
	].includes(typeof value) && String(value).length <= 120));
}
/**
* Creates the append-only audit repository for one D1 binding.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {{writeEvent(event: object): Promise<void>}} Audit event persistence.
*/
function createAuditRepository(database) {
	return Object.freeze({ async writeEvent({ id, eventType, actorType, actorStaffId = null, applicationId = null, documentRecordId = null, requestId, metadata = {} }) {
		const safeMetadata = JSON.stringify(sanitizeAuditMetadata(metadata));
		await database.prepare(`
                INSERT INTO audit_events (
                    id, event_type, actor_type, actor_staff_id, application_id,
                    document_record_id, request_id, safe_metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(id, eventType, actorType, actorStaffId, applicationId, documentRecordId, requestId, safeMetadata).run();
	} });
}
//#endregion
//#region src/server/repositories/d1/scanner-job-statement.js
/**
* Appends a durable job inside either finalize transaction without changing earlier statement row counts.
* @param {D1Database} database D1 binding.
* @param {{fileId: string, finalizedAt: string}} input Exact finalized file identity and UTC time.
* @returns {D1PreparedStatement} Atomic conditional job insert; uniqueness deduplicates reconciliation.
*/
function createScanJobStatement(database, { fileId, finalizedAt }) {
	return database.prepare(`
        INSERT INTO document_scan_jobs
            (id,file_id,revision_id,storage_key,byte_size,media_type,available_at,created_at,updated_at)
        SELECT lower(hex(randomblob(16))), files.id, files.revision_id, files.storage_key,
            files.byte_size, files.media_type,
            strftime('%Y-%m-%dT%H:%M:%fZ', ?), ?, ?
        FROM document_revision_files AS files
        JOIN document_revisions AS revisions ON revisions.id=files.revision_id
        JOIN upload_intents AS intents ON intents.revision_file_id=files.id AND intents.status='completed'
        WHERE files.id=? AND files.upload_status='finalized' AND files.scan_status='pending'
          AND files.cleanup_status='none' AND revisions.is_current=1
        ON CONFLICT(file_id) DO NOTHING
    `).bind(finalizedAt, finalizedAt, finalizedAt, fileId);
}
//#endregion
//#region src/server/repositories/d1/documentRepository.js
var ADDRESS_EVIDENCE_CONDITIONS = Object.freeze({
	"address_evidence:rental_contract": "AND applications.address_evidence_type = 'rental_contract'",
	"address_evidence:residence_certificate": "AND applications.address_evidence_type = 'residence_certificate'",
	"address_evidence:undertaking": "AND applications.address_evidence_type = 'undertaking'"
});
function readConditionalSql(conditionalRule) {
	if (conditionalRule === null || conditionalRule === void 0) return "";
	if (conditionalRule === "under18") return "AND applications.is_under_18 = 1";
	const addressCondition = ADDRESS_EVIDENCE_CONDITIONS[conditionalRule];
	if (addressCondition) return addressCondition;
	throw new TypeError("Unsupported document policy condition.");
}
/**
* Creates the document metadata repository for one D1 binding.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {{findPrivateFileById(fileId: string): Promise<object|null>}} Private document metadata operations.
*/
function createDocumentRepository(database) {
	return Object.freeze({
		async listStudentRequirements(applicationId) {
			return (await database.prepare(`
                SELECT requirements.code, requirements.is_required, requirements.display_order,
                       records.id AS document_record_id,
                       records.review_status, revisions.revision_number, revisions.status AS revision_status,
                       files.upload_status, files.scan_status, files.original_filename, files.media_type,
                       files.id AS file_id,
                       files.cleanup_status AS current_cleanup_status, intents.status AS upload_intent_status,
                       CASE
                         WHEN EXISTS (
                           SELECT 1 FROM document_revision_files AS cleanup_files
                           JOIN document_revisions AS cleanup_revisions ON cleanup_revisions.id = cleanup_files.revision_id
                           WHERE cleanup_revisions.document_record_id = records.id
                             AND cleanup_files.cleanup_status = 'pending'
                         ) THEN 'pending'
                         WHEN EXISTS (
                           SELECT 1 FROM document_revision_files AS cleanup_files
                           JOIN document_revisions AS cleanup_revisions ON cleanup_revisions.id = cleanup_files.revision_id
                           WHERE cleanup_revisions.document_record_id = records.id
                             AND cleanup_files.cleanup_status = 'complete'
                         ) THEN 'complete'
                         ELSE NULL
                       END AS cleanup_status
                FROM applications
                JOIN document_requirements AS requirements
                  ON requirements.application_type = applications.application_type
                 AND requirements.is_active = 1
                LEFT JOIN document_records AS records
                  ON records.application_id = applications.id
                 AND records.requirement_id = requirements.id
                LEFT JOIN document_revisions AS revisions
                  ON revisions.document_record_id = records.id AND revisions.is_current = 1
                LEFT JOIN document_revision_files AS files
                  ON files.revision_id = revisions.id AND files.page_order = 0
                LEFT JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                WHERE applications.id = ?
                ORDER BY requirements.display_order, requirements.code
            `).bind(applicationId).all()).results;
		},
		async listSubmissionRequirementStates(applicationId) {
			return (await database.prepare(`
                SELECT requirements.code, requirements.is_required AS is_required,
                       CASE WHEN requirements.id IS NULL THEN 0 ELSE 1 END AS has_active_requirement,
                       CASE WHEN revisions.id IS NULL THEN 0 ELSE 1 END AS has_current_revision,
                       revisions.status AS revision_status,
                       files.upload_status, files.scan_status, files.cleanup_status,
                       CASE WHEN intents.status = 'completed' THEN 'completed' ELSE NULL END AS upload_intent_status
                FROM applications
                JOIN document_requirements AS requirements
                  ON requirements.application_type = applications.application_type
                 AND requirements.is_active = 1
                LEFT JOIN document_records AS records
                  ON records.application_id = applications.id
                 AND records.requirement_id = requirements.id
                LEFT JOIN document_revisions AS revisions
                  ON revisions.document_record_id = records.id AND revisions.is_current = 1
                LEFT JOIN document_revision_files AS files
                  ON files.revision_id = revisions.id AND files.page_order = 0
                LEFT JOIN upload_intents AS intents
                  ON intents.revision_file_id = files.id
                WHERE applications.id = ?
                ORDER BY requirements.code
            `).bind(applicationId).all()).results;
		},
		async findStudentRequirementId(applicationType, code) {
			return database.prepare(`
                SELECT id FROM document_requirements
                WHERE application_type = ? AND code = ? AND is_active = 1
                LIMIT 1
            `).bind(applicationType, code).first();
		},
		async createStudentUploadIntent({ applicationId, requirementId, conditionalRule, documentRecordId, revisionId, fileId, storageKey, filename, mediaType, byteSize, intentId, idempotencyKey, expiresAt, createdAt }) {
			const conditionalSql = readConditionalSql(conditionalRule);
			return (await database.batch([
				database.prepare(`
                    INSERT INTO document_records (id, application_id, requirement_id, application_type)
                    SELECT ?, applications.id, requirements.id, applications.application_type
                    FROM applications
                    JOIN document_requirements AS requirements
                      ON requirements.application_type = applications.application_type
                    WHERE applications.id = ? AND applications.status = 'draft'
                      AND requirements.id = ? AND requirements.is_active = 1
                      ${conditionalSql}
                    ON CONFLICT(application_id, requirement_id) DO NOTHING
                `).bind(documentRecordId, applicationId, requirementId),
				database.prepare(`
                    UPDATE upload_intents SET status = 'rejected'
                    WHERE status = 'pending' AND revision_file_id IN (
                        SELECT files.id FROM document_revision_files AS files
                        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                        JOIN document_records AS records ON records.id = revisions.document_record_id
                        WHERE records.application_id = ? AND records.requirement_id = ?
                          AND revisions.is_current = 0 AND revisions.status = 'pending_scan'
                    )
                `).bind(applicationId, requirementId),
				database.prepare(`
                    UPDATE document_revision_files SET upload_status = 'rejected'
                    WHERE id IN (
                        SELECT revision_file_id FROM upload_intents
                        WHERE status = 'rejected' AND revision_file_id IN (
                            SELECT files.id FROM document_revision_files AS files
                            JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                            JOIN document_records AS records ON records.id = revisions.document_record_id
                            WHERE records.application_id = ? AND records.requirement_id = ?
                              AND revisions.is_current = 0 AND revisions.status = 'pending_scan'
                        )
                    )
                `).bind(applicationId, requirementId),
				database.prepare(`
                    UPDATE document_revisions SET status = 'superseded'
                    WHERE is_current = 0 AND status = 'pending_scan'
                      AND document_record_id IN (
                          SELECT id FROM document_records WHERE application_id = ? AND requirement_id = ?
                      )
                `).bind(applicationId, requirementId),
				database.prepare(`
                    INSERT INTO document_revisions (
                        id, document_record_id, revision_number, status, is_current,
                        submitted_by_type, uploaded_at
                    )
                    SELECT ?, records.id, COALESCE(MAX(previous.revision_number), 0) + 1,
                           'pending_scan', 0, 'student', ?
                    FROM document_records AS records
                    JOIN applications ON applications.id = records.application_id
                    JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                    LEFT JOIN document_revisions AS previous ON previous.document_record_id = records.id
                    WHERE records.application_id = ? AND records.requirement_id = ?
                      AND applications.status = 'draft' AND requirements.is_active = 1
                      ${conditionalSql}
                    GROUP BY records.id
                `).bind(revisionId, createdAt, applicationId, requirementId),
				database.prepare(`
                    INSERT INTO document_revision_files (
                        id, revision_id, page_order, storage_key, original_filename,
                        media_type, byte_size, upload_status, scan_status, created_at
                    )
                    SELECT ?, id, 0, ?, ?, ?, ?, 'intent', 'pending', ?
                    FROM document_revisions WHERE id = ? AND status = 'pending_scan'
                `).bind(fileId, storageKey, filename, mediaType, byteSize, createdAt, revisionId),
				database.prepare(`
                    INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, created_at)
                    SELECT ?, id, ?, ?, ? FROM document_revision_files WHERE id = ? AND upload_status = 'intent'
                `).bind(intentId, idempotencyKey, expiresAt, createdAt, fileId)
			]))[6]?.meta?.changes === 1;
		},
		async findStudentUploadIntent(applicationId, intentId) {
			return database.prepare(`
                SELECT intents.id, intents.status AS intent_status, intents.expires_at,
                       files.id AS file_id, files.storage_key, files.original_filename,
                       files.media_type, files.byte_size, revisions.id AS revision_id,
                       revisions.revision_number, records.id AS document_record_id,
                       requirements.code
                FROM upload_intents AS intents
                JOIN document_revision_files AS files ON files.id = intents.revision_file_id
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE intents.id = ? AND records.application_id = ?
                LIMIT 1
            `).bind(intentId, applicationId).first();
		},
		async expireStudentUploadIntent(applicationId, intentId) {
			return (await database.prepare(`
                UPDATE upload_intents SET status = 'expired'
                WHERE id = ? AND status = 'pending' AND revision_file_id IN (
                    SELECT files.id FROM document_revision_files AS files
                    JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                    JOIN document_records AS records ON records.id = revisions.document_record_id
                    WHERE records.application_id = ?
                )
            `).bind(intentId, applicationId).run()).meta.changes === 1;
		},
		async rejectStudentUpload(applicationId, intentId) {
			return (await database.batch([
				database.prepare(`
                    UPDATE upload_intents SET status = 'rejected'
                    WHERE id = ? AND status = 'pending' AND revision_file_id IN (
                        SELECT files.id FROM document_revision_files AS files
                        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                        JOIN document_records AS records ON records.id = revisions.document_record_id
                        WHERE records.application_id = ?
                    )
                `).bind(intentId, applicationId),
				database.prepare(`
                    UPDATE document_revision_files SET upload_status = 'rejected'
                    WHERE id IN (SELECT revision_file_id FROM upload_intents WHERE id = ? AND status = 'rejected')
                `).bind(intentId),
				database.prepare(`
                    UPDATE document_revisions SET status = 'superseded'
                    WHERE id IN (SELECT files.revision_id FROM document_revision_files AS files
                                 JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                                 WHERE intents.id = ? AND intents.status = 'rejected')
                      AND is_current = 0
                `).bind(intentId)
			]))[0]?.meta?.changes === 1;
		},
		async finalizeStudentUpload({ applicationId, intentId, fileId, revisionId, documentRecordId, conditionalRule, finalizedAt }) {
			const validPendingIntent = `EXISTS (
                SELECT 1 FROM upload_intents AS intents
                JOIN document_revision_files AS files ON files.id = intents.revision_file_id
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN applications ON applications.id = records.application_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE intents.id = ? AND intents.status = 'pending'
                  AND datetime(intents.expires_at) > datetime(?)
                  AND records.application_id = ? AND applications.status = 'draft'
                  AND requirements.is_active = 1
                  ${readConditionalSql(conditionalRule)}
            )`;
			const results = await database.batch([
				database.prepare(`
                    UPDATE document_revisions SET is_current = 0, status = 'superseded'
                    WHERE document_record_id = ? AND is_current = 1
                      AND ${validPendingIntent}
                `).bind(documentRecordId, intentId, finalizedAt, applicationId),
				database.prepare(`
                    UPDATE document_revisions SET is_current = 1, status = 'submitted', uploaded_at = ?
                    WHERE id = ? AND document_record_id = ? AND is_current = 0 AND status = 'pending_scan'
                      AND ${validPendingIntent}
                `).bind(finalizedAt, revisionId, documentRecordId, intentId, finalizedAt, applicationId),
				database.prepare(`
                    UPDATE document_revision_files SET upload_status = 'finalized', scan_status = 'pending'
                    WHERE id = ? AND revision_id = ? AND upload_status = 'intent'
                      AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1)
                `).bind(fileId, revisionId, revisionId),
				database.prepare(`
                    UPDATE document_records SET review_status = 'pending', updated_at = ? WHERE id = ?
                      AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1)
                `).bind(finalizedAt, documentRecordId, revisionId),
				database.prepare(`
                    UPDATE upload_intents SET status = 'completed', completed_at = ?
                    WHERE id = ? AND status = 'pending' AND revision_file_id = ?
                      AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1)
                `).bind(finalizedAt, intentId, fileId, revisionId),
				createScanJobStatement(database, {
					fileId,
					finalizedAt
				})
			]);
			return results[4]?.meta?.changes === 1 && results[5]?.meta?.changes === 1;
		},
		async beginStudentDocumentDelete({ applicationId, code, requestedAt }) {
			const record = await database.prepare(`
                SELECT records.id, records.review_status,
                       EXISTS (
                           SELECT 1 FROM document_revisions AS revisions
                           WHERE revisions.document_record_id = records.id AND revisions.status = 'approved'
                       ) AS has_approved_revision
                FROM document_records AS records
                JOIN applications ON applications.id = records.application_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE records.application_id = ? AND requirements.code = ?
                  AND requirements.is_active = 1 AND applications.status = 'draft'
                LIMIT 1
            `).bind(applicationId, code).first();
			if (!record) return {
				found: false,
				locked: false
			};
			if (record.review_status === "under_review" || record.review_status === "approved" || record.has_approved_revision) return {
				found: true,
				locked: true
			};
			await database.batch([
				database.prepare(`
                    UPDATE upload_intents SET status = 'rejected'
                    WHERE status = 'pending' AND revision_file_id IN (
                        SELECT files.id FROM document_revision_files AS files
                        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                        WHERE revisions.document_record_id = ?
                    )
                `).bind(record.id),
				database.prepare(`
                    UPDATE document_revisions SET is_current = 0, status = 'superseded'
                    WHERE document_record_id = ? AND status <> 'approved'
                `).bind(record.id),
				database.prepare(`
                    UPDATE document_revision_files SET cleanup_status = 'pending', cleanup_requested_at = ?
                    WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_record_id = ?)
                      AND cleanup_status <> 'complete'
                `).bind(requestedAt, record.id)
			]);
			return {
				found: true,
				locked: false
			};
		},
		async listStudentDocumentCleanupFiles(applicationId, code) {
			return (await database.prepare(`
                SELECT files.id, files.storage_key
                FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE records.application_id = ? AND requirements.code = ?
                  AND files.cleanup_status = 'pending'
                ORDER BY files.created_at, files.id
            `).bind(applicationId, code).all()).results;
		},
		async completeStudentDocumentCleanup(applicationId, code, fileId) {
			return (await database.prepare(`
                UPDATE document_revision_files SET cleanup_status = 'complete'
                WHERE id = ? AND cleanup_status = 'pending'
                  AND revision_id IN (
                      SELECT revisions.id FROM document_revisions AS revisions
                      JOIN document_records AS records ON records.id = revisions.document_record_id
                      JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                      WHERE records.application_id = ? AND requirements.code = ?
                  )
            `).bind(fileId, applicationId, code).run()).meta.changes === 1;
		},
		async findPrivateFileById(fileId) {
			return database.prepare(`
                SELECT files.id, files.storage_key, files.original_filename,
                       files.media_type, files.byte_size, records.application_id
                FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                WHERE files.id = ?
                  AND files.upload_status = 'finalized'
                  AND files.scan_status = 'clean'
                  AND revisions.is_current = 1
                  AND revisions.status IN ('submitted', 'approved', 'resubmission_required')
                LIMIT 1
            `).bind(fileId).first();
		},
		async findCurrentPrivateFileByApplicationAndCode(applicationId, code) {
			return database.prepare(`
                SELECT files.id, files.storage_key, files.original_filename, files.media_type, files.byte_size,
                       records.id AS document_record_id, records.application_id,
                       revisions.id AS revision_id, revisions.revision_number,
                       revisions.status AS revision_status, records.review_status,
                       files.upload_status, files.scan_status, files.cleanup_status,
                       intents.status AS upload_intent_status
                FROM applications
                JOIN document_records AS records ON records.application_id = applications.id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                JOIN document_revisions AS revisions ON revisions.document_record_id = records.id
                JOIN document_revision_files AS files ON files.revision_id = revisions.id AND files.page_order = 0
                JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                WHERE applications.id = ? AND applications.status <> 'draft'
                  AND records.application_type = applications.application_type
                  AND requirements.application_type = applications.application_type
                  AND requirements.code = ? AND requirements.is_active = 1
                  AND revisions.is_current = 1
                  AND revisions.status IN ('submitted', 'approved', 'resubmission_required')
                  AND files.upload_status = 'finalized' AND files.scan_status = 'clean'
                  AND files.cleanup_status = 'none' AND intents.status = 'completed'
                LIMIT 1
            `).bind(applicationId, code).first();
		}
	});
}
//#endregion
//#region src/server/repositories/d1/resubmissionUploadRepository.js
function readModeGuard(mode) {
	if (mode === "first_replacement") return `records.review_status = 'resubmission_required'
            AND current_revision.status = 'resubmission_required'
            AND current_file.scan_status IN ('clean', 'unsafe', 'failed')`;
	if (mode === "unsafe_scan_retry") return `records.review_status = 'pending'
            AND current_revision.status = 'submitted'
            AND current_file.scan_status IN ('unsafe', 'failed')
            AND current_intent.status = 'completed'`;
	throw new TypeError("Unsupported resubmission replacement mode.");
}
function bindModeFacts(input) {
	return [
		input.applicationType,
		input.isUnder18 ? 1 : 0,
		input.addressEvidenceType ?? null,
		input.requirementId,
		input.code,
		input.documentRecordId,
		input.expectedCurrentRevisionId
	];
}
function readEligibilitySql() {
	return `
        SELECT applications.id AS application_id, applications.status AS application_status,
               applications.application_type, applications.is_under_18,
               applications.address_evidence_type, requirements.id AS requirement_id,
               requirements.code, requirements.is_required,
               records.id AS document_record_id, records.review_status,
               current_revision.id AS current_revision_id, current_revision.revision_number,
               current_revision.status AS revision_status, current_revision.is_current,
               current_file.id AS file_id, current_file.original_filename,
               current_file.media_type, current_file.byte_size,
               current_file.upload_status, current_file.scan_status, current_file.cleanup_status,
               current_intent.status AS upload_intent_status,
               EXISTS (
                   SELECT 1 FROM application_notes
                   WHERE application_notes.application_id = applications.id
                     AND application_notes.document_record_id = records.id
                     AND application_notes.visibility = 'student'
               ) AS has_student_message_for_document,
               EXISTS (
                   SELECT 1 FROM document_revision_files AS cleanup_files
                   JOIN document_revisions AS cleanup_revisions ON cleanup_revisions.id = cleanup_files.revision_id
                   WHERE cleanup_revisions.document_record_id = records.id
                     AND cleanup_revisions.is_current = 0
                     AND cleanup_files.cleanup_status = 'pending'
               ) AS has_non_current_cleanup_pending
        FROM applications
        JOIN document_requirements AS requirements
          ON requirements.application_type = applications.application_type AND requirements.is_active = 1
        LEFT JOIN document_records AS records
          ON records.application_id = applications.id AND records.requirement_id = requirements.id
        LEFT JOIN document_revisions AS current_revision
          ON current_revision.document_record_id = records.id AND current_revision.is_current = 1
        LEFT JOIN document_revision_files AS current_file
          ON current_file.revision_id = current_revision.id AND current_file.page_order = 0
        LEFT JOIN upload_intents AS current_intent ON current_intent.revision_file_id = current_file.id
        WHERE applications.id = ? AND (? IS NULL OR requirements.code = ?)
        ORDER BY requirements.display_order, requirements.code
    `;
}
function readExactReplacementEligibilitySql(mode) {
	return `
        applications.status = 'resubmission_required'
        AND applications.application_type = ? AND COALESCE(applications.is_under_18, 0) IS ?
        AND applications.address_evidence_type IS ?
        AND requirements.id = ? AND requirements.code = ? AND requirements.is_active = 1
        AND records.id = ? AND records.application_id = applications.id
        AND current_revision.id = ? AND current_revision.document_record_id = records.id
        AND current_revision.is_current = 1
        AND current_file.revision_id = current_revision.id AND current_file.page_order = 0
        AND current_file.upload_status = 'finalized' AND current_file.cleanup_status <> 'pending'
        AND current_intent.status = 'completed'
        AND EXISTS (
            SELECT 1 FROM application_notes
            WHERE application_notes.application_id = applications.id
              AND application_notes.document_record_id = records.id
              AND application_notes.visibility = 'student'
        )
        AND ${readModeGuard(mode)}
    `;
}
function readRevisionMismatchError(error) {
	return /NOT NULL constraint failed: audit_events\.request_id/.test(error?.message || "");
}
function encodeIntentGuard(input) {
	return JSON.stringify([
		input.expectedCurrentRevisionId,
		input.mode,
		input.idempotencyKey
	]);
}
function readIntentGuard(value) {
	try {
		const [expectedCurrentRevisionId, mode] = JSON.parse(value);
		if (typeof expectedCurrentRevisionId === "string" && ["first_replacement", "unsafe_scan_retry"].includes(mode)) return {
			expected_current_revision_id: expectedCurrentRevisionId,
			mode
		};
	} catch {
		return null;
	}
	return null;
}
function readFinalizeStatements(database, input) {
	const modeGuard = readModeGuard(input.mode);
	return [
		database.prepare(`
            UPDATE document_revisions AS current_revision
            SET is_current = 0, status = 'superseded'
            WHERE current_revision.id = ? AND current_revision.document_record_id = ?
              AND current_revision.is_current = 1
              AND EXISTS (
                SELECT 1 FROM applications
                JOIN document_records AS records ON records.application_id = applications.id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                JOIN document_revisions AS current_revision_check
                  ON current_revision_check.document_record_id = records.id AND current_revision_check.is_current = 1
                JOIN document_revision_files AS current_file
                  ON current_file.revision_id = current_revision_check.id AND current_file.page_order = 0
                JOIN upload_intents AS current_intent ON current_intent.revision_file_id = current_file.id
                WHERE applications.id = ? AND applications.application_type = ?
                  AND COALESCE(applications.is_under_18, 0) IS ? AND applications.address_evidence_type IS ?
                  AND requirements.id = ? AND requirements.code = ? AND requirements.is_active = 1
                  AND records.id = ? AND current_revision_check.id = ?
                  AND current_revision_check.id = current_revision.id
                  AND current_file.upload_status = 'finalized' AND current_file.cleanup_status <> 'pending'
                  AND current_intent.status = 'completed'
                  AND EXISTS (
                    SELECT 1 FROM application_notes
                    WHERE application_notes.application_id = applications.id
                      AND application_notes.document_record_id = records.id
                      AND application_notes.visibility = 'student'
                  )
                  AND ${modeGuard}
              )
        `).bind(input.expectedCurrentRevisionId, input.documentRecordId, input.applicationId, ...bindModeFacts(input)),
		database.prepare(`
            UPDATE document_revisions
            SET is_current = 1, status = 'submitted', uploaded_at = ?
            WHERE id = ? AND document_record_id = ? AND is_current = 0 AND status = 'pending_scan'
              AND changes() = 1
              AND EXISTS (
                SELECT 1 FROM upload_intents
                JOIN document_revision_files ON document_revision_files.id = upload_intents.revision_file_id
                WHERE upload_intents.id = ? AND upload_intents.status = 'pending'
                  AND datetime(upload_intents.expires_at) > datetime(?)
                  AND document_revision_files.id = ? AND document_revision_files.revision_id = ?
              )
        `).bind(input.finalizedAt, input.replacementRevisionId, input.documentRecordId, input.intentId, input.finalizedAt, input.replacementFileId, input.replacementRevisionId),
		database.prepare(`
            UPDATE document_revision_files
            SET upload_status = 'finalized', scan_status = 'pending'
            WHERE id = ? AND revision_id = ? AND upload_status = 'intent'
              AND cleanup_status = 'none' AND changes() = 1
              AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1 AND status = 'submitted')
        `).bind(input.replacementFileId, input.replacementRevisionId, input.replacementRevisionId),
		database.prepare(`
            UPDATE document_records SET review_status = 'pending', updated_at = ?
            WHERE id = ? AND application_id = ? AND review_status = ? AND changes() = 1
              AND EXISTS (
                SELECT 1 FROM document_revisions WHERE id = ? AND document_record_id = document_records.id
                  AND is_current = 1 AND status = 'submitted'
              )
        `).bind(input.finalizedAt, input.documentRecordId, input.applicationId, input.mode === "first_replacement" ? "resubmission_required" : "pending", input.replacementRevisionId),
		database.prepare(`
            UPDATE applications SET updated_at = ?, last_activity_at = ?
            WHERE id = ? AND status = 'resubmission_required' AND changes() = 1
              AND EXISTS (
                SELECT 1 FROM document_records
                WHERE id = ? AND application_id = applications.id AND review_status = 'pending'
              )
        `).bind(input.finalizedAt, input.finalizedAt, input.applicationId, input.documentRecordId),
		database.prepare(`
            UPDATE upload_intents SET status = 'completed', completed_at = ?
            WHERE id = ? AND status = 'pending' AND revision_file_id = ? AND changes() = 1
              AND datetime(expires_at) > datetime(?)
              AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1 AND status = 'submitted')
        `).bind(input.finalizedAt, input.intentId, input.replacementFileId, input.finalizedAt, input.replacementRevisionId),
		database.prepare(`
            INSERT INTO audit_events (
                id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at
            ) VALUES (
                ?, 'student.document_resubmitted', 'student', ?,
                CASE WHEN changes() = 1 THEN ? ELSE NULL END, ?, ?
            )
        `).bind(input.auditId, input.applicationId, input.requestId, JSON.stringify({
			documentCode: input.code,
			revisionNumber: input.revisionNumber,
			documentStatus: "submitted",
			result: "success"
		}), input.finalizedAt),
		createScanJobStatement(database, {
			fileId: input.replacementFileId,
			finalizedAt: input.finalizedAt
		})
	];
}
/** Creates D1 persistence operations for the separate student resubmission flow. */
function createResubmissionUploadRepository(database) {
	return Object.freeze({
		async readEligibility(applicationId, code) {
			const result = await database.prepare(readEligibilitySql()).bind(applicationId, code ?? null, code ?? null).all();
			if (code !== void 0) return result.results[0] ?? null;
			return result.results;
		},
		async createIntent(input) {
			const modePredicate = readExactReplacementEligibilitySql(input.mode);
			const modeValues = bindModeFacts(input);
			return (await database.batch([
				database.prepare(`
                    INSERT INTO document_revisions (
                        id, document_record_id, revision_number, status, is_current, submitted_by_type
                    )
                    SELECT ?, records.id,
                        (SELECT COALESCE(MAX(previous.revision_number), 0) + 1
                         FROM document_revisions AS previous WHERE previous.document_record_id = records.id),
                        'pending_scan', 0, 'student'
                    FROM applications
                    JOIN document_requirements AS requirements ON requirements.application_type = applications.application_type
                    JOIN document_records AS records ON records.application_id = applications.id
                      AND records.requirement_id = requirements.id
                    JOIN document_revisions AS current_revision ON current_revision.document_record_id = records.id
                      AND current_revision.is_current = 1
                    JOIN document_revision_files AS current_file ON current_file.revision_id = current_revision.id
                      AND current_file.page_order = 0
                    JOIN upload_intents AS current_intent ON current_intent.revision_file_id = current_file.id
                    WHERE applications.id = ? AND ${modePredicate}
                    GROUP BY records.id
                `).bind(input.revisionId, input.applicationId, ...modeValues),
				database.prepare(`
                    INSERT INTO document_revision_files (
                        id, revision_id, page_order, storage_key, original_filename,
                        media_type, byte_size, upload_status, scan_status, cleanup_status, created_at
                    )
                    SELECT ?, ?, 0, ?, ?, ?, ?, 'intent', 'pending', 'none', ?
                    WHERE changes() = 1 AND EXISTS (
                        SELECT 1 FROM document_revisions WHERE id = ? AND status = 'pending_scan' AND is_current = 0
                    )
                `).bind(input.fileId, input.revisionId, input.storageKey, input.filename, input.mediaType, input.byteSize, input.createdAt, input.revisionId),
				database.prepare(`
                    INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, created_at)
                    SELECT ?, ?, ?, ?, ? WHERE changes() = 1
                      AND EXISTS (SELECT 1 FROM document_revision_files WHERE id = ? AND upload_status = 'intent')
                `).bind(input.intentId, input.fileId, encodeIntentGuard(input), input.expiresAt, input.createdAt, input.fileId),
				database.prepare(`
                    UPDATE upload_intents SET status = 'rejected'
                    WHERE changes() = 1 AND id <> ? AND status = 'pending' AND revision_file_id IN (
                        SELECT files.id FROM document_revision_files AS files
                        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                        WHERE revisions.document_record_id = ? AND revisions.is_current = 0
                          AND revisions.status = 'pending_scan'
                    )
                `).bind(input.intentId, input.documentRecordId),
				database.prepare(`
                    UPDATE document_revision_files SET upload_status = 'rejected',
                        cleanup_status = 'pending', cleanup_requested_at = ?
                    WHERE changes() = 1 AND revision_id IN (
                        SELECT revisions.id FROM document_revisions AS revisions
                        JOIN document_revision_files AS old_files ON old_files.revision_id = revisions.id
                        JOIN upload_intents AS old_intents ON old_intents.revision_file_id = old_files.id
                        WHERE revisions.document_record_id = ? AND revisions.is_current = 0
                      AND revisions.status = 'pending_scan' AND old_intents.status = 'rejected'
                          AND old_intents.id <> ?
                    )
                `).bind(input.createdAt, input.documentRecordId, input.intentId),
				database.prepare(`
                    UPDATE document_revisions SET status = 'superseded'
                    WHERE changes() = 1 AND document_record_id = ? AND is_current = 0 AND status = 'pending_scan'
                      AND EXISTS (
                        SELECT 1 FROM document_revision_files AS files
                        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                        WHERE files.revision_id = document_revisions.id AND files.upload_status = 'rejected'
                          AND files.cleanup_status = 'pending' AND intents.status = 'rejected' AND intents.id <> ?
                      )
                `).bind(input.documentRecordId, input.intentId)
			]))[2]?.meta?.changes === 1;
		},
		async findIntent(applicationId, intentId) {
			const intent = await database.prepare(`
                SELECT intents.id, intents.idempotency_key, intents.status AS intent_status, intents.expires_at,
                       files.id AS file_id, files.storage_key, files.original_filename, files.media_type,
                       files.byte_size, files.upload_status, files.cleanup_status, files.scan_status,
                       revisions.id AS revision_id, revisions.revision_number, revisions.status AS revision_status,
                       revisions.is_current, records.id AS document_record_id, records.review_status,
                       applications.id AS application_id, applications.status AS application_status,
                       applications.application_type, applications.is_under_18, applications.address_evidence_type,
                       requirements.id AS requirement_id, requirements.code, requirements.is_active
                FROM upload_intents AS intents
                JOIN document_revision_files AS files ON files.id = intents.revision_file_id
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN applications ON applications.id = records.application_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE intents.id = ? AND applications.id = ? LIMIT 1
            `).bind(intentId, applicationId).first();
			if (!intent) return null;
			const guard = readIntentGuard(intent.idempotency_key);
			if (!guard) return null;
			return {
				...intent,
				...guard
			};
		},
		async expireIntent(applicationId, intentId, expiredAt) {
			return invalidateIntent(database, {
				applicationId,
				intentId,
				changedAt: expiredAt,
				status: "expired"
			});
		},
		async listExpiredPendingIntents(applicationId) {
			return (await database.prepare(`
                SELECT intents.id
                FROM upload_intents AS intents
                JOIN document_revision_files AS files ON files.id = intents.revision_file_id
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                WHERE records.application_id = ? AND revisions.is_current = 0
                  AND revisions.status = 'pending_scan' AND intents.status = 'pending'
                  AND datetime(intents.expires_at) <= datetime('now')
                ORDER BY intents.expires_at, intents.id
            `).bind(applicationId).all()).results;
		},
		async invalidatePendingIntent(applicationId, documentRecordId, intentId, invalidatedAt) {
			return invalidateIntent(database, {
				applicationId,
				documentRecordId,
				intentId,
				changedAt: invalidatedAt,
				status: "rejected"
			});
		},
		async listRetryableCleanup(applicationId, code) {
			return (await database.prepare(`
                SELECT files.id, files.storage_key
                FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                WHERE records.application_id = ? AND (? IS NULL OR requirements.code = ?)
                  AND revisions.is_current = 0 AND revisions.status = 'superseded'
                  AND files.upload_status = 'rejected' AND files.cleanup_status = 'pending'
                  AND intents.status IN ('expired', 'rejected')
                  AND datetime(intents.expires_at) <= datetime('now')
                ORDER BY files.cleanup_requested_at, files.id
            `).bind(applicationId, code ?? null, code ?? null).all()).results;
		},
		async markCleanupComplete(applicationId, fileId) {
			return (await database.prepare(`
                UPDATE document_revision_files SET cleanup_status = 'complete'
                WHERE id = ? AND cleanup_status = 'pending' AND upload_status = 'rejected'
                  AND revision_id IN (
                    SELECT revisions.id FROM document_revisions AS revisions
                    JOIN document_records AS records ON records.id = revisions.document_record_id
                    WHERE records.application_id = ? AND revisions.is_current = 0 AND revisions.status = 'superseded'
                  )
                  AND EXISTS (
                    SELECT 1 FROM upload_intents WHERE upload_intents.revision_file_id = document_revision_files.id
                      AND upload_intents.status IN ('expired', 'rejected')
                      AND datetime(upload_intents.expires_at) <= datetime('now')
                  )
            `).bind(fileId, applicationId).run()).meta.changes === 1;
		},
		async finalizeReplacement(input) {
			try {
				return (await database.batch(readFinalizeStatements(database, input))).every((result) => result?.meta?.changes === 1);
			} catch (error) {
				if (readRevisionMismatchError(error)) return false;
				throw error;
			}
		}
	});
}
async function invalidateIntent(database, { applicationId, documentRecordId, intentId, changedAt, status }) {
	const recordFilter = documentRecordId === void 0 ? "" : "AND records.id = ?";
	const recordValues = documentRecordId === void 0 ? [] : [documentRecordId];
	return (await database.batch([
		database.prepare(`
            UPDATE upload_intents SET status = ?
            WHERE id = ? AND status = 'pending' AND revision_file_id IN (
                SELECT files.id FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                WHERE records.application_id = ? ${recordFilter}
                  AND revisions.is_current = 0 AND revisions.status = 'pending_scan'
            )
        `).bind(status, intentId, applicationId, ...recordValues),
		database.prepare(`
            UPDATE document_revision_files SET upload_status = 'rejected',
                cleanup_status = 'pending', cleanup_requested_at = ?
            WHERE id IN (SELECT revision_file_id FROM upload_intents WHERE id = ? AND status = ?)
              AND upload_status IN ('intent', 'uploaded', 'quarantined') AND changes() = 1
              AND revision_id IN (SELECT id FROM document_revisions WHERE is_current = 0 AND status = 'pending_scan')
        `).bind(changedAt, intentId, status),
		database.prepare(`
            UPDATE document_revisions SET status = 'superseded'
            WHERE id IN (SELECT files.revision_id FROM document_revision_files AS files
                         JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                         WHERE intents.id = ? AND intents.status = ? AND files.cleanup_status = 'pending')
              AND is_current = 0 AND status = 'pending_scan' AND changes() = 1
        `).bind(intentId, status)
	])).every((result) => result?.meta?.changes === 1);
}
//#endregion
//#region src/server/repositories/d1/notificationRepository.js
/** Signals reuse of an idempotency key for a different notification payload. */
var NotificationIdempotencyConflictError = class extends Error {
	constructor() {
		super("The idempotency key is already bound to another notification payload.");
		this.name = "NotificationIdempotencyConflictError";
		this.code = "NOTIFICATION_IDEMPOTENCY_CONFLICT";
	}
};
function mapNotification(row) {
	if (!row) return null;
	return {
		id: row.id,
		application_id: row.application_id,
		channel: row.channel,
		template_key: row.template_key,
		language: row.language,
		recipient_masked: row.recipient_masked,
		status: row.status,
		provider_status: row.provider_status,
		attempt_count: row.attempt_count,
		last_error_code: row.last_error_code,
		created_at: row.created_at,
		sent_at: row.sent_at,
		delivered_at: row.delivered_at,
		read_at: row.read_at,
		can_retry: row.outbox_status === "retry" && row.attempt_count < 5 && ["provider_transient_failure", "provider_rate_limited"].includes(row.outbox_error_code) && row.provider_status === "not_sent"
	};
}
function readQueryRows(result) {
	return result?.results || [];
}
async function readIdempotentNotification(database, scope, key) {
	return await database.prepare(`
        SELECT n.*, i.request_fingerprint
        FROM idempotency_records i
        JOIN notifications n ON n.id = i.resource_id
        WHERE i.scope = ? AND i.idempotency_key = ?
    `).bind(scope, key).first() || null;
}
function makeAuditStatement(database, event) {
	return database.prepare(`
        INSERT INTO audit_events (
            id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json
        ) VALUES (?, ?, 'staff', ?, ?, ?, ?)
    `).bind(event.id, event.eventType, event.staffUserId, event.applicationId, event.requestId, JSON.stringify(event.metadata));
}
function createProviderEventInsert(database, input) {
	return database.prepare(`
        INSERT OR IGNORE INTO notification_provider_webhook_events (
            id, notification_id, provider_message_id, provider_status, provider_timestamp, received_at
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(input.eventId, input.notificationId, input.providerMessageId, input.providerStatus, input.providerTimestamp, input.receivedAt);
}
function createProviderNotificationUpdate(database, input) {
	return database.prepare(`
        UPDATE notifications SET
            provider_status = ?, status = ?,
            sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, ?) ELSE sent_at END,
            delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, ?) ELSE delivered_at END,
            read_at = CASE WHEN ? = 'read' THEN COALESCE(read_at, ?) ELSE read_at END,
            failed_at = CASE WHEN ? = 'failed' THEN COALESCE(failed_at, ?) ELSE failed_at END,
            last_error_code = CASE WHEN ? = 'failed' THEN 'provider_delivery_failed' ELSE last_error_code END
        WHERE id = ? AND provider_status <> 'failed'
            AND CASE provider_status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3
        WHEN 'failed' THEN 3 WHEN 'sent' THEN 2 WHEN 'accepted' THEN 1 ELSE 0 END < CASE ? WHEN 'read' THEN 4 WHEN 'delivered' THEN 3
        WHEN 'failed' THEN 3 WHEN 'sent' THEN 2 ELSE 0 END
    `).bind(input.providerStatus, input.providerStatus, input.providerStatus, input.providerTimestamp, input.providerStatus, input.providerTimestamp, input.providerStatus, input.providerTimestamp, input.providerStatus, input.providerTimestamp, input.providerStatus, input.notificationId, input.providerStatus);
}
function createProviderStatusAudit(database, input) {
	return database.prepare(`
        INSERT INTO audit_events (
            id, event_type, actor_type, application_id, request_id, safe_metadata_json
        ) SELECT ?, 'system.notification_provider_status_received', 'system', application_id, ?, ?
        FROM notifications WHERE id = ? AND changes() = 1
    `).bind(input.eventId, input.requestId, JSON.stringify({ providerStatus: input.providerStatus }), input.notificationId);
}
async function enqueueOnce(database, input) {
	const expiresAt = new Date(Date.parse(input.createdAt) + 31536e6).toISOString();
	await database.batch([
		database.prepare(`
            INSERT INTO idempotency_records (
                scope, idempotency_key, request_fingerprint, resource_id, response_status, expires_at
            ) VALUES (?, ?, ?, ?, 202, ?)
        `).bind(input.idempotencyScope, input.idempotencyKey, input.fingerprint, input.notificationId, expiresAt),
		database.prepare(`
            INSERT INTO notifications (
                id, application_id, created_by_staff_id, channel, template_key, language,
                recipient_masked, is_manual, rendered_message, provider_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'not_sent')
        `).bind(input.notificationId, input.applicationId, input.staffUserId, input.channel, input.templateKey, input.language, input.recipientMasked, input.renderedMessage),
		database.prepare(`
            INSERT INTO notification_outbox (id, notification_id, idempotency_key, status, next_attempt_at)
            VALUES (?, ?, ?, 'pending', ?)
        `).bind(input.outboxId, input.notificationId, input.outboxId, input.createdAt),
		database.prepare(`
            UPDATE idempotency_records SET resource_id = ? WHERE scope = ? AND idempotency_key = ?
        `).bind(input.notificationId, input.idempotencyScope, input.idempotencyKey),
		makeAuditStatement(database, {
			id: input.auditEventId,
			eventType: "staff.notification_enqueued",
			staffUserId: input.staffUserId,
			applicationId: input.applicationId,
			requestId: input.requestId,
			metadata: {
				channel: input.channel,
				templateKey: input.templateKey,
				language: input.language,
				result: "queued"
			}
		})
	]);
	return mapNotification(await database.prepare("SELECT * FROM notifications WHERE id = ?").bind(input.notificationId).first());
}
async function enqueueManualNotification(database, input) {
	const existing = await readIdempotentNotification(database, input.idempotencyScope, input.idempotencyKey);
	if (existing) {
		if (existing.request_fingerprint !== input.fingerprint) throw new NotificationIdempotencyConflictError();
		return {
			notification: mapNotification(existing),
			isExisting: true
		};
	}
	try {
		return {
			notification: await enqueueOnce(database, input),
			isExisting: false
		};
	} catch (error) {
		const concurrent = await readIdempotentNotification(database, input.idempotencyScope, input.idempotencyKey);
		if (!concurrent) throw error;
		if (concurrent.request_fingerprint !== input.fingerprint) throw new NotificationIdempotencyConflictError();
		return {
			notification: mapNotification(concurrent),
			isExisting: true
		};
	}
}
/** Creates D1 persistence for consent, manual notifications, and durable outbox dispatch. */
function createNotificationRepository(database) {
	return Object.freeze({
		async readApplicationContext(applicationId) {
			return database.prepare(`
                SELECT a.id, a.status, a.student_phone, a.student_email
                FROM applications a WHERE a.id = ?
            `).bind(applicationId).first();
		},
		async readPreferences(applicationId) {
			const row = await database.prepare(`
                SELECT whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_consent_version,
                    whatsapp_consent_language, whatsapp_phone_hash, whatsapp_opt_out_at
                FROM notification_preferences WHERE application_id = ?
            `).bind(applicationId).first();
			return row ? {
				whatsapp_opt_in: row.whatsapp_opt_in === 1,
				whatsapp_opt_in_at: row.whatsapp_opt_in_at,
				whatsapp_consent_version: row.whatsapp_consent_version,
				whatsapp_consent_language: row.whatsapp_consent_language,
				whatsapp_phone_hash: row.whatsapp_phone_hash,
				whatsapp_opt_out_at: row.whatsapp_opt_out_at
			} : {
				whatsapp_opt_in: false,
				whatsapp_opt_in_at: null,
				whatsapp_consent_version: null,
				whatsapp_consent_language: null,
				whatsapp_phone_hash: null,
				whatsapp_opt_out_at: null
			};
		},
		async updateApplicantPreferences(input) {
			await database.batch([database.prepare(`
                    INSERT INTO notification_preferences (
                        application_id, whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_consent_version,
                        whatsapp_consent_language, whatsapp_phone_hash, whatsapp_opt_out_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(application_id) DO UPDATE SET
                        whatsapp_opt_in = excluded.whatsapp_opt_in,
                        whatsapp_opt_in_at = excluded.whatsapp_opt_in_at,
                        whatsapp_consent_version = excluded.whatsapp_consent_version,
                        whatsapp_consent_language = excluded.whatsapp_consent_language,
                        whatsapp_phone_hash = excluded.whatsapp_phone_hash,
                        whatsapp_opt_out_at = excluded.whatsapp_opt_out_at,
                        updated_at = excluded.updated_at
                `).bind(input.applicationId, input.isOptedIn ? 1 : 0, input.optedInAt, input.consentVersion, input.language, input.phoneHash, input.optedOutAt, input.updatedAt), database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json
                    ) VALUES (?, 'applicant.notification_preferences_updated', 'student', ?, ?, ?)
                `).bind(input.auditEventId, input.applicationId, input.requestId, JSON.stringify({
				channel: "whatsapp",
				optedIn: input.isOptedIn,
				consentVersion: input.consentVersion,
				language: input.language
			}))]);
			return this.readPreferences(input.applicationId);
		},
		async writeStaffPreviewAudit(input) {
			await database.batch([makeAuditStatement(database, {
				id: input.auditEventId,
				eventType: "staff.notification_previewed",
				staffUserId: input.staffUserId,
				applicationId: input.applicationId,
				requestId: input.requestId,
				metadata: {
					channel: input.channel,
					templateKey: input.templateKey,
					language: input.language,
					result: input.result
				}
			})]);
		},
		async enqueueManualNotification(input) {
			return enqueueManualNotification(database, input);
		},
		async readIdempotentNotification(input) {
			const existing = await readIdempotentNotification(database, input.idempotencyScope, input.idempotencyKey);
			if (!existing) return null;
			if (existing.request_fingerprint !== input.fingerprint) throw new NotificationIdempotencyConflictError();
			return mapNotification(existing);
		},
		async listHistory(applicationId, limit = 50) {
			return readQueryRows(await database.prepare(`
                SELECT id, application_id, channel, template_key, language, recipient_masked,
                    status, provider_status, attempt_count, last_error_code, created_at,
                    sent_at, delivered_at, read_at,
                    (SELECT o.status FROM notification_outbox o WHERE o.notification_id = notifications.id) AS outbox_status,
                    (SELECT o.last_error_code FROM notification_outbox o WHERE o.notification_id = notifications.id) AS outbox_error_code
                FROM notifications WHERE application_id = ? ORDER BY created_at DESC LIMIT ?
            `).bind(applicationId, limit).all()).map(mapNotification);
		},
		async findHistoryItem(applicationId, notificationId) {
			return database.prepare(`
                SELECT id, application_id, channel, template_key, language, recipient_masked,
                    status, provider_status, attempt_count, last_error_code, created_at,
                    sent_at, delivered_at, read_at,
                    (SELECT o.status FROM notification_outbox o WHERE o.notification_id = notifications.id) AS outbox_status,
                    (SELECT o.last_error_code FROM notification_outbox o WHERE o.notification_id = notifications.id) AS outbox_error_code
                FROM notifications WHERE application_id = ? AND id = ?
            `).bind(applicationId, notificationId).first();
		},
		async findByProviderMessageId(providerMessageId) {
			return (await database.prepare(`
                SELECT id FROM notifications WHERE channel = 'whatsapp' AND provider_message_id = ?
            `).bind(providerMessageId).first())?.id || null;
		},
		async recordProviderStatusEvent(input) {
			await database.batch([
				createProviderEventInsert(database, input),
				createProviderNotificationUpdate(database, input),
				createProviderStatusAudit(database, input)
			]);
		},
		async expediteRetry(input) {
			return (await database.batch([database.prepare(`
                UPDATE notification_outbox
                SET next_attempt_at = ?, updated_at = ?
                WHERE notification_id = ? AND status = 'retry' AND attempt_count < ?
                    AND last_error_code IN ('provider_transient_failure', 'provider_rate_limited')
                    AND EXISTS (
                        SELECT 1 FROM notifications n WHERE n.id = notification_outbox.notification_id
                            AND n.application_id = ? AND n.provider_status = 'not_sent'
                    )
            `).bind(input.now, input.now, input.notificationId, input.maxAttempts, input.applicationId), database.prepare(`
                INSERT INTO audit_events (
                    id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json
                ) SELECT ?, 'staff.notification_retry_requested', 'staff', ?, ?, ?, ?
                WHERE changes() = 1
            `).bind(input.auditEventId, input.staffUserId, input.applicationId, input.requestId, JSON.stringify({
				notificationId: input.notificationId,
				result: "retry_scheduled"
			}))]))[0]?.meta?.changes === 1;
		},
		async claimNextOutbox(input) {
			return readQueryRows(await database.prepare(`
                UPDATE notification_outbox
                SET status = 'processing', attempt_count = attempt_count + 1,
                    locked_at = ?, lease_token = ?, dispatch_started_at = NULL, updated_at = ?
                WHERE id = (
                    SELECT id FROM notification_outbox
                    WHERE (status IN ('pending', 'retry') AND next_attempt_at <= ?)
                        OR (status = 'processing' AND locked_at <= ? AND dispatch_started_at IS NULL)
                    ORDER BY next_attempt_at, created_at LIMIT 1
                )
                RETURNING id, notification_id, attempt_count, lease_token
            `).bind(input.now, input.leaseToken, input.now, input.now, input.staleBefore).all())[0] || null;
		},
		async markDispatchStarted(input) {
			return (await database.batch([database.prepare(`
                    UPDATE notification_outbox SET dispatch_started_at = ?, updated_at = ?
                    WHERE notification_id = ? AND status = 'processing' AND lease_token = ?
                        AND dispatch_started_at IS NULL
                `).bind(input.now, input.now, input.notificationId, input.leaseToken), database.prepare(`
                    UPDATE notifications SET status = 'processing', provider_status = 'unknown'
                    WHERE id = ? AND EXISTS (SELECT 1 FROM notification_outbox o
                        WHERE o.notification_id = notifications.id AND o.status = 'processing'
                            AND o.lease_token = ? AND o.dispatch_started_at = ?)
                `).bind(input.notificationId, input.leaseToken, input.now)]))[1]?.meta?.changes === 1;
		},
		async recoverAmbiguousDispatch(input) {
			const stale = await database.prepare(`
                SELECT id, notification_id FROM notification_outbox
                WHERE status = 'processing' AND dispatch_started_at IS NOT NULL AND locked_at <= ?
                ORDER BY locked_at LIMIT 1
            `).bind(input.staleBefore).first();
			if (!stale) return false;
			return (await database.batch([
				database.prepare(`
                    UPDATE notifications SET status = 'failed', provider_status = 'unknown',
                        last_error_code = 'provider_outcome_unknown', failed_at = ?
                    WHERE id = ? AND EXISTS (SELECT 1 FROM notification_outbox o
                        WHERE o.id = ? AND o.status = 'processing' AND o.dispatch_started_at IS NOT NULL AND o.locked_at <= ?)
                `).bind(input.now, stale.notification_id, stale.id, input.staleBefore),
				database.prepare(`
                    UPDATE notification_outbox SET status = 'dead', last_error_code = 'provider_outcome_unknown',
                        locked_at = NULL, lease_token = NULL, updated_at = ?
                    WHERE id = ? AND status = 'processing' AND dispatch_started_at IS NOT NULL AND locked_at <= ?
                `).bind(input.now, stale.id, input.staleBefore),
				database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json
                    ) SELECT ?, 'system.notification_dispatch_result', 'system', n.application_id, ?, ?
                    FROM notifications n JOIN notification_outbox o ON o.notification_id = n.id
                    WHERE n.id = ? AND n.last_error_code = 'provider_outcome_unknown'
                        AND o.id = ? AND o.status = 'dead' AND o.updated_at = ? AND changes() = 1
                `).bind(input.auditEventId, input.requestId, JSON.stringify({
					result: "unknown",
					providerStatus: "unknown",
					errorCode: "provider_outcome_unknown"
				}), stale.notification_id, stale.id, input.now)
			]))[2]?.meta?.changes === 1;
		},
		async loadDispatchEnvelope(notificationId) {
			return database.prepare(`
                SELECT n.id, n.application_id, n.channel, n.template_key, n.language,
                    n.rendered_message, a.status AS application_status, a.student_phone, a.student_email,
                    COALESCE(p.whatsapp_opt_in, 0) AS whatsapp_opt_in,
                    p.whatsapp_phone_hash, p.whatsapp_consent_version,
                    o.id AS outbox_id, o.attempt_count, o.lease_token
                FROM notifications n
                JOIN applications a ON a.id = n.application_id
                JOIN notification_outbox o ON o.notification_id = n.id
                LEFT JOIN notification_preferences p ON p.application_id = n.application_id
                WHERE n.id = ?
            `).bind(notificationId).first();
		},
		async finishDispatch(input) {
			return (await database.batch([
				database.prepare(`
                    UPDATE notifications SET status = ?, provider_status = ?, provider_message_id = ?,
                        last_error_code = ?, failed_at = ?, sent_at = ?, attempt_count = ?
                    WHERE id = ? AND EXISTS (
                        SELECT 1 FROM notification_outbox o
                        WHERE o.notification_id = notifications.id AND o.status = 'processing' AND o.lease_token = ?
                    )
                `).bind(input.notificationStatus, input.providerStatus, input.providerMessageId, input.errorCode, input.failedAt, input.sentAt, input.attemptCount, input.notificationId, input.leaseToken),
				database.prepare(`
                    UPDATE notification_outbox SET status = ?, last_error_code = ?, locked_at = NULL,
                        lease_token = NULL, dispatch_started_at = NULL, updated_at = ?
                    WHERE notification_id = ? AND status = 'processing' AND lease_token = ?
                `).bind(input.outboxStatus, input.errorCode, input.now, input.notificationId, input.leaseToken),
				database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json
                    ) SELECT ?, 'system.notification_dispatch_result', 'system', ?, ?, ?
                    WHERE changes() = 1
                `).bind(input.auditEventId, input.applicationId, input.requestId, JSON.stringify({
					notificationId: input.notificationId,
					result: input.auditResult,
					providerStatus: input.providerStatus,
					errorCode: input.errorCode
				}))
			]))[1]?.meta?.changes === 1;
		},
		async scheduleRetry(input) {
			return (await database.batch([
				database.prepare(`
                    UPDATE notifications SET status = 'queued', provider_status = 'not_sent',
                        last_error_code = ?, attempt_count = ? WHERE id = ?
                        AND EXISTS (SELECT 1 FROM notification_outbox o WHERE o.notification_id = notifications.id
                            AND o.status = 'processing' AND o.lease_token = ?)
                `).bind(input.errorCode, input.attemptCount, input.notificationId, input.leaseToken),
				database.prepare(`
                    UPDATE notification_outbox SET status = 'retry', next_attempt_at = ?,
                        last_error_code = ?, locked_at = NULL, lease_token = NULL,
                        dispatch_started_at = NULL, updated_at = ?
                    WHERE notification_id = ? AND status = 'processing' AND lease_token = ?
                `).bind(input.nextAttemptAt, input.errorCode, input.now, input.notificationId, input.leaseToken),
				database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json
                    ) SELECT ?, 'system.notification_dispatch_result', 'system', ?, ?, ?
                    WHERE changes() = 1
                `).bind(input.auditEventId, input.applicationId, input.requestId, JSON.stringify({
					notificationId: input.notificationId,
					result: "retry_scheduled",
					providerStatus: "not_sent",
					errorCode: input.errorCode
				}))
			]))[1]?.meta?.changes === 1;
		}
	});
}
//#endregion
//#region src/server/repositories/d1/rateLimitRepository.js
/**
* Creates the short-lived hashed-key public request limiter repository.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {{consume(input: object): Promise<object|null>}} Rate limit persistence operations.
*/
function createRateLimitRepository(database) {
	return Object.freeze({ async consume({ endpoint, requestKeyHash, nowSeconds, windowSeconds, maxRequests }) {
		await database.prepare(`
                INSERT INTO public_rate_limits (endpoint, request_key_hash, window_started_at, request_count)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(endpoint, request_key_hash) DO UPDATE SET
                    request_count = CASE
                        WHEN public_rate_limits.window_started_at <= ? THEN 1
                        ELSE public_rate_limits.request_count + 1
                    END,
                    window_started_at = CASE
                        WHEN public_rate_limits.window_started_at <= ? THEN excluded.window_started_at
                        ELSE public_rate_limits.window_started_at
                    END,
                    blocked_until = CASE
                        WHEN public_rate_limits.window_started_at <= ? THEN NULL
                        WHEN public_rate_limits.request_count + 1 > ? THEN ?
                        ELSE public_rate_limits.blocked_until
                    END,
                    updated_at = CURRENT_TIMESTAMP
            `).bind(endpoint, requestKeyHash, nowSeconds, nowSeconds - windowSeconds, nowSeconds - windowSeconds, nowSeconds - windowSeconds, maxRequests, nowSeconds + windowSeconds).run();
		return database.prepare(`
                SELECT request_count, blocked_until
                FROM public_rate_limits WHERE endpoint = ? AND request_key_hash = ?
            `).bind(endpoint, requestKeyHash).first();
	} });
}
//#endregion
//#region src/server/repositories/d1/sessionRepository.js
/**
* Creates staff and student session repositories for one D1 binding.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {object} Session lookup, persistence, revocation, and login throttle operations.
*/
function createSessionRepository(database) {
	return Object.freeze({
		async createStaffSession({ id, staffUserId, tokenHash, expiresAt, createdAt }) {
			await database.prepare(`
                INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).bind(id, staffUserId, tokenHash, expiresAt, createdAt).run();
		},
		async createApplicationSession({ id, applicationId, tokenHash, expiresAt, createdAt }) {
			await database.prepare(`
                INSERT INTO application_sessions (id, application_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).bind(id, applicationId, tokenHash, expiresAt, createdAt).run();
		},
		async createApplicationSessionGuarded({ id, applicationId, tokenHash, expiresAt, createdAt, expectedAccessCodeVersion }) {
			return ((await database.prepare(`
                INSERT INTO application_sessions (id, application_id, token_hash, expires_at, created_at)
                SELECT ?, ?, ?, ?, ?
                FROM applications
                WHERE id = ? AND access_code_version = ? AND status NOT IN ('completed','cancelled','rejected')
            `).bind(id, applicationId, tokenHash, expiresAt, createdAt, applicationId, expectedAccessCodeVersion).run())?.meta?.changes ?? 0) > 0;
		},
		async findApplicationSession(tokenHash, now) {
			return database.prepare(`
                SELECT sessions.id AS session_id, sessions.expires_at,
                       applications.id AS application_id, applications.status,
                       applications.application_type, applications.access_code_version, applications.student_email,
                       applications.student_phone, applications.first_name,
                       applications.last_name, applications.passport_number,
                       applications.nationality, applications.date_of_birth,
                       applications.is_under_18, applications.declaration_version,
                       applications.declaration_accepted_at, students.student_number
                FROM application_sessions AS sessions
                JOIN applications ON applications.id = sessions.application_id
                JOIN students ON students.id = applications.student_id
                WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL
                  AND sessions.expires_at > ?
                LIMIT 1
            `).bind(tokenHash, now).first();
		},
		async revokeApplicationSession(tokenHash, revokedAt) {
			await database.prepare(`
                UPDATE application_sessions SET revoked_at = ?
                WHERE token_hash = ? AND revoked_at IS NULL
            `).bind(revokedAt, tokenHash).run();
		},
		async revokeAllApplicationSessions(applicationId, revokedAt) {
			await database.prepare(`
                UPDATE application_sessions SET revoked_at = ?
                WHERE application_id = ? AND revoked_at IS NULL
            `).bind(revokedAt, applicationId).run();
		},
		async findStaffSession(tokenHash, now, idleCutoff, touchCutoff) {
			await database.prepare(`
                UPDATE staff_sessions SET last_seen_at = ?
                WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
                  AND julianday(last_seen_at) > julianday(?)
                  AND julianday(last_seen_at) <= julianday(?)
                  AND EXISTS (SELECT 1 FROM staff_users WHERE id = staff_sessions.staff_user_id AND is_active = 1)
            `).bind(now, tokenHash, now, idleCutoff, touchCutoff).run();
			return database.prepare(`
                SELECT sessions.id AS session_id, sessions.expires_at, sessions.revoked_at,
                       staff.id, staff.username, staff.display_name, staff.role, staff.auth_version
                FROM staff_sessions AS sessions
                JOIN staff_users AS staff ON staff.id = sessions.staff_user_id
                WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL
                  AND sessions.expires_at > ? AND julianday(sessions.last_seen_at) > julianday(?)
                  AND staff.is_active = 1
                LIMIT 1
            `).bind(tokenHash, now, idleCutoff).first();
		},
		async revokeStaffSessionWithAudit({ tokenHash, revokedAt, idleCutoff, auditEventId, requestId }) {
			await database.batch([database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, request_id, safe_metadata_json, created_at
                    ) SELECT ?, 'staff.logout', 'staff', sessions.staff_user_id, ?, '{}', ?
                    FROM staff_sessions AS sessions
                    JOIN staff_users AS staff ON staff.id = sessions.staff_user_id
                    WHERE sessions.token_hash = ? AND sessions.revoked_at IS NULL
                      AND sessions.expires_at > ? AND julianday(sessions.last_seen_at) > julianday(?)
                      AND staff.is_active = 1
                `).bind(auditEventId, requestId, revokedAt, tokenHash, revokedAt, idleCutoff), database.prepare(`
                    UPDATE staff_sessions SET revoked_at = ?
                    WHERE token_hash = ? AND revoked_at IS NULL
                `).bind(revokedAt, tokenHash)]);
		},
		async revokeAllStaffSessions(staffUserId, revokedAt) {
			await database.prepare(`
                UPDATE staff_sessions SET revoked_at = ?
                WHERE staff_user_id = ? AND revoked_at IS NULL
            `).bind(revokedAt, staffUserId).run();
		},
		async isLoginBlocked(attemptKey, nowSeconds) {
			const attempt = await database.prepare(`
                SELECT blocked_until FROM staff_login_attempts
                WHERE attempt_key = ? AND blocked_until > ?
            `).bind(attemptKey, nowSeconds).first();
			return Boolean(attempt);
		},
		async recordFailedLogin(attemptKey, nowSeconds, { maxAttempts = 5, windowSeconds = 900 } = {}) {
			await database.prepare(`
                INSERT INTO staff_login_attempts (attempt_key, window_started_at, attempt_count, blocked_until)
                VALUES (?, ?, 1, NULL)
                ON CONFLICT(attempt_key) DO UPDATE SET
                    attempt_count = CASE
                        WHEN staff_login_attempts.window_started_at <= ? THEN 1
                        ELSE staff_login_attempts.attempt_count + 1
                    END,
                    window_started_at = CASE
                        WHEN staff_login_attempts.window_started_at <= ? THEN excluded.window_started_at
                        ELSE staff_login_attempts.window_started_at
                    END,
                    blocked_until = CASE
                        WHEN staff_login_attempts.window_started_at <= ? THEN NULL
                        WHEN staff_login_attempts.attempt_count + 1 >= ? THEN ?
                        ELSE staff_login_attempts.blocked_until
                    END,
                    updated_at = CURRENT_TIMESTAMP
            `).bind(attemptKey, nowSeconds, nowSeconds - windowSeconds, nowSeconds - windowSeconds, nowSeconds - windowSeconds, maxAttempts, nowSeconds + windowSeconds).run();
		},
		async clearLoginAttempts(attemptKey) {
			await database.prepare("DELETE FROM staff_login_attempts WHERE attempt_key = ?").bind(attemptKey).run();
		}
	});
}
//#endregion
//#region src/server/repositories/d1/staffRepository.js
/**
* Normalizes a staff username for case-insensitive account lookup.
* @param {string} username Username supplied by staff.
* @returns {string} Lowercase normalized username.
* @throws {TypeError} When the username format is invalid.
*/
function normalizeUsername(username) {
	if (typeof username !== "string") throw new TypeError("Username must be text.");
	const normalizedUsername = username.trim().toLocaleLowerCase("en-US");
	if (!/^[a-z0-9._@#-]{3,64}$/.test(normalizedUsername)) throw new TypeError("Username format is invalid.");
	return normalizedUsername;
}
/**
* Creates the staff identity repository for one D1 binding.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {object} Staff account operations that never return password hashes in public DTOs.
*/
function createStaffRepository(database) {
	return Object.freeze({
		async findByUsername(username) {
			const normalizedUsername = normalizeUsername(username);
			return database.prepare("SELECT * FROM staff_users WHERE normalized_username = ?").bind(normalizedUsername).first();
		},
		async findById(id) {
			return database.prepare("SELECT * FROM staff_users WHERE id = ?").bind(id).first();
		},
		async hasBootstrapAdmin() {
			const result = await database.prepare(`
                SELECT 1 AS configured FROM staff_bootstrap_state WHERE id = 1
                UNION ALL SELECT 1 AS configured FROM staff_users LIMIT 1
            `).first();
			return Boolean(result);
		},
		async createFirstAdmin({ id, username, passwordHash, displayName, createdAt, requestId }) {
			const normalizedUsername = normalizeUsername(username);
			const statements = [
				database.prepare(`
                    INSERT INTO staff_bootstrap_state (id, staff_user_id, completed_at)
                    SELECT 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM staff_users)
                `).bind(id, createdAt),
				database.prepare(`
                    INSERT INTO staff_users (
                        id, username, normalized_username, password_hash,
                        display_name, role, created_at, updated_at
                    ) SELECT ?, ?, ?, ?, ?, 'admin', ?, ?
                    WHERE EXISTS (SELECT 1 FROM staff_bootstrap_state WHERE id = 1 AND staff_user_id = ?)
                `).bind(id, username.trim(), normalizedUsername, passwordHash, displayName.trim(), createdAt, createdAt, id),
				database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id,
                        request_id, safe_metadata_json, created_at
                    ) SELECT ?, 'staff.admin_bootstrapped', 'staff', ?, ?, '{}', ?
                    WHERE EXISTS (SELECT 1 FROM staff_bootstrap_state WHERE id = 1 AND staff_user_id = ?)
                `).bind(crypto.randomUUID(), id, requestId, createdAt, id)
			];
			const results = await database.batch(statements);
			if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1 || results[2]?.meta?.changes !== 1) return null;
			return this.findById(id);
		},
		async updateLastLogin(id, lastLoginAt) {
			await database.prepare(`
                UPDATE staff_users SET last_login_at = ?, updated_at = ? WHERE id = ? AND is_active = 1
            `).bind(lastLoginAt, lastLoginAt, id).run();
		}
	});
}
//#endregion
//#region src/server/repositories/d1/index.js
/**
* Creates all D1-backed persistence adapters behind domain-specific interfaces.
* @param {D1Database} database Cloudflare D1 binding.
* @returns {object} Repository collection used by application services and Worker routes.
*/
function createD1Repositories(database) {
	if (!database) throw new TypeError("A D1 database binding is required.");
	const applicationNotes = createApplicationNoteRepository(database);
	return Object.freeze({
		applications: createApplicationRepository(database),
		applicationNotes,
		applicationReviews: createApplicationReviewRepository(database, applicationNotes),
		audit: createAuditRepository(database),
		documents: createDocumentRepository(database),
		resubmissionUploads: createResubmissionUploadRepository(database),
		notifications: createNotificationRepository(database),
		rateLimits: createRateLimitRepository(database),
		sessions: createSessionRepository(database),
		staff: createStaffRepository(database),
		students: createStudentRepository(database)
	});
}
//#endregion
//#region src/server/auth/sessionToken.js
var STAFF_COOKIE_NAME = "staff_session";
var APPLICATION_COOKIE_NAME = "application_session";
var encoder$2 = new TextEncoder();
function encodeBase64Url$1(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
/**
* Creates a cryptographically random opaque session token.
* @returns {string} A 256-bit base64url token for an HttpOnly cookie.
*/
function createOpaqueSessionToken() {
	return encodeBase64Url$1(crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32)));
}
/**
* Hashes an opaque session token before it is stored in D1.
* @param {string} token Opaque browser session token.
* @returns {Promise<string>} Lowercase SHA-256 hex digest.
*/
async function hashSessionToken(token) {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder$2.encode(token)));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/**
* Reads a named value from a Cookie header without exposing other cookie values.
* @param {Request} request Fetch API request.
* @param {string} cookieName Cookie name to retrieve.
* @returns {string|null} Decoded cookie value, or null when missing or malformed.
*/
function readCookie(request, cookieName) {
	const cookieHeader = request.headers.get("Cookie");
	if (!cookieHeader) return null;
	for (const item of cookieHeader.split(";")) {
		const separator = item.indexOf("=");
		if (separator < 0 || item.slice(0, separator).trim() !== cookieName) continue;
		try {
			return decodeURIComponent(item.slice(separator + 1).trim());
		} catch {
			return null;
		}
	}
	return null;
}
/**
* Builds a same-site, HttpOnly cookie for a server-managed session.
* @param {'staff'|'application'} sessionType Session cookie domain.
* @param {string} token Opaque session token.
* @param {number} maxAgeSeconds Cookie lifetime in seconds.
* @returns {string} Set-Cookie header value.
*/
function createSessionCookie(sessionType, token, maxAgeSeconds) {
	return `${sessionType === "staff" ? STAFF_COOKIE_NAME : APPLICATION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}
/**
* Builds an expired same-site session cookie.
* @param {'staff'|'application'} sessionType Session cookie domain.
* @returns {string} Expired Set-Cookie header value.
*/
function createExpiredSessionCookie(sessionType) {
	return `${sessionType === "staff" ? STAFF_COOKIE_NAME : APPLICATION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
/**
* Returns the cookie name for a session domain.
* @param {'staff'|'application'} sessionType Session cookie domain.
* @returns {string} Cookie name.
*/
function getSessionCookieName(sessionType) {
	return sessionType === "staff" ? STAFF_COOKIE_NAME : APPLICATION_COOKIE_NAME;
}
//#endregion
//#region src/server/config/sessionPolicy.js
var STAFF_IDLE_TIMEOUT_SECONDS = 3600;
//#endregion
//#region src/server/config/sharedStaffAccount.js
/**
* Reads the one configured staff identity used by login and active sessions.
* @param {object} environment Worker bindings.
* @returns {string} Normalized shared staff username.
* @throws {ApiError} When the shared identity is missing or invalid.
*/
function readSharedStaffUsername(environment) {
	try {
		return normalizeUsername(environment.STAFF_SHARED_USERNAME);
	} catch {
		throw new ApiError(503, "SERVICE_UNAVAILABLE", "Yetkili hesabı yapılandırılmamış. Lütfen sistem yöneticisine başvurun.", true);
	}
}
//#endregion
//#region src/server/auth/staffAuth.js
/**
* Requires an active D1-backed staff session and optional role allowlist.
* @param {Request} request Fetch API request.
* @param {object} environment Cloudflare Worker bindings.
* @param {readonly string[]} [roles] Roles allowed to continue.
* @returns {Promise<object>} Safe staff identity attached to the active session.
* @throws {ApiError|RepositoryConfigurationError} When the session is missing or disallowed.
*/
async function requireStaff(request, environment, roles) {
	if (!environment.DB) throw new RepositoryConfigurationError();
	const sessionToken = readCookie(request, getSessionCookieName("staff"));
	if (!sessionToken || !/^[A-Za-z0-9_-]{40,48}$/.test(sessionToken)) throw new ApiError(401, "UNAUTHORIZED", "Yetkili oturumu gerekli.");
	const repositories = createD1Repositories(environment.DB);
	const nowDate = /* @__PURE__ */ new Date();
	const now = nowDate.toISOString();
	const idleCutoff = (/* @__PURE__ */ new Date(nowDate.valueOf() - STAFF_IDLE_TIMEOUT_SECONDS * 1e3)).toISOString();
	const touchCutoff = (/* @__PURE__ */ new Date(nowDate.valueOf() - 3e5)).toISOString();
	const session = await repositories.sessions.findStaffSession(await hashSessionToken(sessionToken), now, idleCutoff, touchCutoff);
	if (!session) throw new ApiError(401, "UNAUTHORIZED", "Yetkili oturumu gerekli.");
	const sharedUsername = readSharedStaffUsername(environment);
	let sessionUsername;
	try {
		sessionUsername = normalizeUsername(session.username);
	} catch {
		throw new ApiError(401, "UNAUTHORIZED", "Yetkili oturumu gerekli.");
	}
	if (sessionUsername !== sharedUsername) throw new ApiError(401, "UNAUTHORIZED", "Yetkili oturumu gerekli.");
	if (roles && !roles.includes(session.role)) throw new ApiError(403, "FORBIDDEN", "Bu işlem için yetkiniz yok.");
	return Object.freeze({
		id: session.id,
		username: session.username,
		displayName: session.display_name,
		role: session.role
	});
}
//#endregion
//#region src/server/domain/print-gate.js
/**
* Check the explicit operator switch; missing or malformed values fail closed.
* @param {Readonly<Record<string, unknown>>} environment Worker bindings.
* @returns {boolean} Whether new print work is enabled.
*/
function isPrintEnabled(environment) {
	return environment.PRINT_ENABLED === "true";
}
/**
* Gate all print work while preserving status and authenticated recovery.
* @param {string} pathname API request path.
* @param {Readonly<Record<string, unknown>>} environment Worker bindings.
* @returns {void}
* @throws {ApiError} When print work is disabled.
*/
function requirePrintRequestEnabled(pathname, environment) {
	if (isPrintEnabled(environment)) return;
	if (pathname.startsWith("/api/public/print/")) {
		if (["/api/public/print/status", "/api/public/print/jobs/status"].includes(pathname)) return;
		throwPrintDisabled();
	}
	if (!pathname.startsWith("/api/printer/")) return;
	if (["/api/printer/heartbeat", "/api/printer/reconcile"].includes(pathname)) return;
	if (/^\/api\/printer\/jobs\/[A-Za-z0-9_-]{1,64}\/result$/.test(pathname)) return;
	throwPrintDisabled();
}
function throwPrintDisabled() {
	throw new ApiError(503, "PRINT_DISABLED", "Yazdırma şu anda kapalı.", true);
}
//#endregion
//#region src/server/domain/print-uat-policy.js
var MAX_UAT_WINDOW_MS = 9e5;
var PRINT_UAT_SLOT_ID = "staff-print-uat-v7";
/**
* Read a bounded staff UAT policy; malformed settings fail closed.
* @param {Readonly<Record<string, unknown>>} environment Worker bindings.
* @param {number} now Current epoch milliseconds.
* @returns {Readonly<{startedAt: number, expiresAt: number, documentHash: string}>|null} Active policy.
*/
function readPrintUatPolicy(environment, now = Date.now()) {
	if (environment.PRINT_ENABLED !== "false" || environment.PRINT_UAT_ENABLED !== "true") return null;
	const startedAt = parseUatTimestamp(environment.PRINT_UAT_STARTED_AT);
	const expiresAt = parseUatTimestamp(environment.PRINT_UAT_EXPIRES_AT);
	const documentHash = environment.PRINT_UAT_DOCUMENT_SHA256;
	if (!Number.isFinite(now) || !Number.isFinite(startedAt) || !Number.isFinite(expiresAt) || expiresAt <= startedAt || expiresAt - startedAt > MAX_UAT_WINDOW_MS || now < startedAt || now >= expiresAt || typeof documentHash !== "string" || !/^[a-f0-9]{64}$/.test(documentHash)) return null;
	return Object.freeze({
		startedAt,
		expiresAt,
		documentHash
	});
}
/**
* Restrict staff UAT without changing production limits.
* @param {Readonly<Record<string, unknown>>} input Browser upload settings.
* @param {Readonly<Record<string, unknown>>} environment Worker bindings.
* @returns {void}
* @throws {ApiError} When settings or the UAT window are invalid.
*/
function requirePrintUatUpload(input, environment) {
	if (!requireActivePrintUatPolicy(environment)) return;
	if (input.media_type !== "application/pdf" || input.copies !== 1 || input.paper_size !== "A4" || input.color_mode !== "monochrome" || input.duplex !== "simplex") throw new ApiError(400, "PRINT_UAT_INPUT_INVALID", "UAT yalnız tek sentetik PDF kopyasını kabul eder.");
}
/**
* Bind every v7 UAT attempt to one server-controlled slot, including later windows.
* @param {Readonly<Record<string, unknown>>} environment Worker bindings.
* @returns {string|null} Server-controlled idempotency scope.
* @throws {ApiError} When a configured UAT window has expired.
*/
function readPrintUatIdempotencyScope(environment) {
	if (!requireActivePrintUatPolicy(environment)) return null;
	return PRINT_UAT_SLOT_ID;
}
/**
* Recheck expiry immediately before a database transition.
* @param {Readonly<Record<string, unknown>>} environment Worker bindings.
* @returns {string|null} Canonical UTC deadline for the database clock guard.
* @throws {ApiError} When the configured window is no longer active.
*/
function readPrintUatDeadline(environment) {
	const policy = requireActivePrintUatPolicy(environment);
	return policy ? new Date(policy.expiresAt).toISOString() : null;
}
/**
* Verify the synthetic file before queueing and delivering its bytes to the Agent.
* @param {Uint8Array} bytes Uploaded document bytes.
* @param {Readonly<Record<string, unknown>>} environment Worker bindings.
* @returns {Promise<void>}
* @throws {ApiError} When content differs or the UAT window has expired.
*/
async function requirePrintUatContent(bytes, environment) {
	const policy = requireActivePrintUatPolicy(environment);
	if (!policy) return;
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	requireActivePrintUatPolicy(environment);
	if ([...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") !== policy.documentHash) throw new ApiError(415, "PRINT_UAT_DOCUMENT_INVALID", "UAT sentetik dosyası doğrulanamadı.");
}
function requireActivePrintUatPolicy(environment) {
	const policy = readPrintUatPolicy(environment);
	if (!policy && !isPrintEnabled(environment) && environment.PRINT_UAT_ENABLED === "true") throw new ApiError(503, "PRINT_DISABLED", "Yazdırma şu anda kapalı.", true);
	return policy;
}
function parseUatTimestamp(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}
//#endregion
//#region src/server/services/print-access.js
/**
* Require a real staff session for every browser print API during bounded UAT.
* @param {Request} request Incoming API request.
* @param {Readonly<Record<string, unknown>>} environment Worker bindings.
* @returns {Promise<void>}
* @throws {ApiError} When printing is closed or staff authentication fails.
*/
async function requirePrintRequestAccess(request, environment) {
	const { pathname } = new URL(request.url);
	if (pathname === "/api/public/print/status" || pathname === "/api/staff/print/uat/status") return;
	if (isPrintEnabled(environment) || !readPrintUatPolicy(environment)) {
		requirePrintRequestEnabled(pathname, environment);
		return;
	}
	if (pathname.startsWith("/api/public/print/")) {
		await requireStaff(request, environment, ["reviewer", "admin"]);
		return;
	}
	if (pathname.startsWith("/api/printer/")) return;
	requirePrintRequestEnabled(pathname, environment);
}
var MAX_PRINT_PAGE_COPIES = 1e3;
var DEFAULT_PRINT_LIMITS = Object.freeze({
	maxCopies: 50,
	maxPageCopies: 200,
	isValid: true
});
var PRINT_HEARTBEAT_MAX_AGE_MS = 6e4;
var PRINT_UPLOAD_TTL_MS = 6e5;
var PRINT_SUCCESS_RETENTION_MS = 9e5;
var PRINT_FAILURE_RETENTION_MS = 36e5;
var PRINT_ROW_RETENTION_MS = 864e5;
var PRINT_LEASE_MS = 3e5;
var ALLOWED_MEDIA_TYPES = /* @__PURE__ */ new Set([
	"application/pdf",
	"image/jpeg",
	"image/png"
]);
var RESULT_CODES$1 = /* @__PURE__ */ new Set([
	"submitted",
	"printer_unavailable",
	"validation_failed",
	"unsupported_content",
	"invalid_print_options",
	"page_copy_budget_exceeded",
	"spooler_error",
	"submission_unknown"
]);
var ALLOWED_PAPER_SIZES = /* @__PURE__ */ new Set(["A4", "A3"]);
var ALLOWED_COLOR_MODES = /* @__PURE__ */ new Set(["monochrome", "color"]);
var ALLOWED_DUPLEX_MODES = /* @__PURE__ */ new Set(["simplex", "duplexlong"]);
var ALLOWED_ORIENTATIONS = /* @__PURE__ */ new Set(["portrait", "landscape"]);
function readPrintLimits(environment = {}) {
	const maxCopies = readConfiguredLimit(environment.PRINT_MAX_COPIES_PER_JOB, 50, 50);
	const maxPageCopies = readConfiguredLimit(environment.PRINT_MAX_PAGE_COPIES, 200, MAX_PRINT_PAGE_COPIES);
	return Object.freeze({
		maxCopies: maxCopies.value,
		maxPageCopies: maxPageCopies.value,
		isValid: maxCopies.isValid && maxPageCopies.isValid
	});
}
function readConfiguredLimit(value, fallback, maximum) {
	if (value === void 0) return {
		value: fallback,
		isValid: true
	};
	if (typeof value !== "string" || !/^\d+$/.test(value)) return {
		value: fallback,
		isValid: false
	};
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return {
		value: fallback,
		isValid: false
	};
	return {
		value: parsed,
		isValid: true
	};
}
function readPrintOptionCapabilities(environment = {}, settingsProtocol = 0) {
	const agentSupportsSettings = settingsProtocol >= 1;
	const orientationModes = settingsProtocol >= 3 ? ["portrait", "landscape"] : ["portrait"];
	const limits = readPrintLimits(environment);
	return Object.freeze({
		paper_sizes: Object.freeze(environment.PRINT_ENABLE_A3 === "true" && agentSupportsSettings ? ["A4", "A3"] : ["A4"]),
		color_modes: Object.freeze(environment.PRINT_ENABLE_COLOR === "true" && agentSupportsSettings ? ["monochrome", "color"] : ["monochrome"]),
		duplex_modes: Object.freeze(environment.PRINT_ENABLE_DUPLEX === "true" && agentSupportsSettings ? ["simplex", "duplexlong"] : ["simplex"]),
		orientations: Object.freeze(orientationModes),
		limits: Object.freeze({
			max_copies: settingsProtocol >= 2 ? limits.maxCopies : Math.min(limits.maxCopies, 3),
			max_page_copies: limits.maxPageCopies
		})
	});
}
function validatePrintUpload(input, capabilities = readPrintOptionCapabilities()) {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidPrintInput();
	if (!ALLOWED_MEDIA_TYPES.has(input.media_type)) throw new ApiError(415, "PRINT_UNSUPPORTED_MEDIA", "PDF, JPG veya PNG dosyası seçin.");
	if (!Number.isSafeInteger(input.byte_size) || input.byte_size < 1 || input.byte_size > 10485760) throw new ApiError(413, "PRINT_FILE_SIZE_INVALID", "Dosya boyutu izin verilen sınırı aşıyor.");
	const maxCopies = capabilities.limits?.max_copies ?? 3;
	const orientations = capabilities.orientations || ["portrait"];
	if (!Number.isSafeInteger(input.copies) || input.copies < 1 || input.copies > maxCopies) throw invalidPrintInput();
	const orientation = input.orientation ?? "portrait";
	if (!ALLOWED_PAPER_SIZES.has(input.paper_size) || !capabilities.paper_sizes.includes(input.paper_size) || !ALLOWED_COLOR_MODES.has(input.color_mode) || !capabilities.color_modes.includes(input.color_mode) || !ALLOWED_DUPLEX_MODES.has(input.duplex) || !capabilities.duplex_modes.includes(input.duplex) || !ALLOWED_ORIENTATIONS.has(orientation) || !orientations.includes(orientation)) throw invalidPrintInput();
	const settingsProtocol = orientation === "landscape" ? 3 : input.copies > 3 ? 2 : input.paper_size !== "A4" || input.color_mode !== "monochrome" || input.duplex !== "simplex" ? 1 : 0;
	return Object.freeze({
		mediaType: input.media_type,
		byteSize: input.byte_size,
		copies: input.copies,
		paperSize: input.paper_size,
		colorMode: input.color_mode,
		duplex: input.duplex,
		orientation,
		requiredProtocol: settingsProtocol
	});
}
function validatePrintMagicBytes(mediaType, bytes) {
	if (!(bytes instanceof Uint8Array)) return false;
	if (mediaType === "application/pdf") return new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
	if (mediaType === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (mediaType === "image/png") return bytes.length >= 8 && [
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	].every((byte, index) => bytes[index] === byte);
	return false;
}
function validatePrintResult(input) {
	if (!input || typeof input !== "object" || ![
		"submitted",
		"failed",
		"unknown"
	].includes(input.status) || !RESULT_CODES$1.has(input.result_code)) throw invalidPrintInput();
	if (input.status === "submitted" && input.result_code !== "submitted") throw invalidPrintInput();
	if (input.status === "unknown" && input.result_code !== "submission_unknown") throw invalidPrintInput();
	if (input.spooler_job_id !== null && !(typeof input.spooler_job_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(input.spooler_job_id))) throw invalidPrintInput();
	return Object.freeze({
		status: input.status,
		resultCode: input.result_code,
		spoolerJobId: input.spooler_job_id
	});
}
function invalidPrintInput() {
	return new ApiError(400, "INVALID_PRINT_INPUT", "Yazdırma isteği doğrulanamadı.");
}
//#endregion
//#region src/server/repositories/d1/printRepository.js
function addMilliseconds(value, amount) {
	return new Date(Date.parse(value) + amount).toISOString();
}
function createPrintRepository(database) {
	if (!database) throw new TypeError("A D1 database binding is required.");
	return Object.freeze({
		async readPublicStatus(now, limits = DEFAULT_PRINT_LIMITS) {
			const [heartbeat, queue] = await Promise.all([database.prepare(`SELECT health, seen_at, settings_protocol FROM printer_heartbeats
                    ORDER BY seen_at DESC LIMIT 1`).first(), database.prepare(`SELECT count(*) AS count FROM print_jobs WHERE status IN
                    ('uploading','queued','leased','ready','submission_started') AND cleanup_status='none'`).first()]);
			const heartbeatAge = heartbeat ? Date.parse(now) - Date.parse(heartbeat.seen_at) : Infinity;
			const heartbeatIsFresh = heartbeat && heartbeat.health === "ready" && heartbeatAge >= -3e4 && heartbeatAge <= 6e4;
			const settingsProtocol = heartbeatIsFresh ? heartbeat?.settings_protocol || 0 : 0;
			return {
				available: Boolean(heartbeatIsFresh && queue.count < 50 && limits.isValid),
				settingsProtocol,
				limits: {
					max_copies: settingsProtocol >= 2 ? limits.maxCopies : Math.min(limits.maxCopies, 3),
					max_page_copies: limits.maxPageCopies
				}
			};
		},
		async createUploadIntent(input) {
			const orientation = input.orientation || "portrait";
			const result = await database.prepare(`INSERT INTO print_jobs (
                id,idempotency_key_hash,upload_token_hash,tracking_token_hash,storage_key,media_type,byte_size,copies,
                paper_size,color_mode,duplex,orientation,
                status,available_at,created_at,updated_at,expires_at,purge_after
            ) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'uploading',?,?,?,?,?
              WHERE (SELECT count(*) FROM print_jobs WHERE status IN
                    ('uploading','queued','leased','ready','submission_started') AND cleanup_status='none') < ?
                AND (SELECT health FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)='ready'
                AND (SELECT seen_at FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)>=?
                AND (SELECT settings_protocol FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)>=?
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)
                ON CONFLICT(idempotency_key_hash) DO NOTHING
            RETURNING *`).bind(input.id, input.idempotencyHash, input.uploadTokenHash, input.trackingTokenHash, input.storageKey, input.mediaType, input.byteSize, input.copies, input.paperSize, input.colorMode, input.duplex, orientation, input.now, input.now, input.now, input.expiresAt, input.purgeAfter, 50, input.heartbeatCutoff, input.requiredProtocol || 0, input.uatExpiresAt || null, input.uatExpiresAt || null).first();
			if (result) return result;
			const existing = await database.prepare("SELECT * FROM print_jobs WHERE idempotency_key_hash=?").bind(input.idempotencyHash).first();
			if (existing && existing.upload_token_hash === input.uploadTokenHash && existing.tracking_token_hash === input.trackingTokenHash && existing.byte_size === input.byteSize && existing.media_type === input.mediaType && existing.copies === input.copies && existing.paper_size === input.paperSize && existing.color_mode === input.colorMode && existing.duplex === input.duplex && existing.orientation === orientation) return existing;
			return null;
		},
		findByIdempotencyHash: (hash) => database.prepare("SELECT * FROM print_jobs WHERE idempotency_key_hash=?").bind(hash).first(),
		findUploadIntent: ({ id, tokenHash, now }) => database.prepare(`SELECT * FROM print_jobs
            WHERE id=? AND upload_token_hash=? AND status='uploading' AND expires_at>? AND cleanup_status='none'`).bind(id, tokenHash, now).first(),
		markQueued: async ({ id, tokenHash, now, expiresAt, uatExpiresAt = null }) => {
			return (await database.prepare(`UPDATE print_jobs SET status='queued',page_count=NULL,
                available_at=?,updated_at=?,expires_at=? WHERE id=? AND upload_token_hash=?
                AND status='uploading' AND expires_at>? AND cleanup_status='none'
                AND (SELECT health FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)='ready'
                AND (SELECT seen_at FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)>=?
                AND (SELECT count(*) FROM print_jobs WHERE status IN
                    ('uploading','queued','leased','ready','submission_started') AND cleanup_status='none' AND id<>?) < ?
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)`).bind(now, now, expiresAt, id, tokenHash, now, (/* @__PURE__ */ new Date(Date.parse(now) - 6e4)).toISOString(), id, 50, uatExpiresAt, uatExpiresAt).run()).meta.changes === 1;
		},
		async claim({ now, runnerId, leaseTokenHash, limits = DEFAULT_PRINT_LIMITS, jobId = null, minimumProtocol = 0, uatExpiresAt = null }) {
			const leaseUntil = addMilliseconds(now, PRINT_LEASE_MS);
			return database.prepare(`UPDATE print_jobs SET status='leased',attempts=attempts+1,runner_id=?,
                lease_token_hash=?,lease_until=?,updated_at=?
                WHERE id=(SELECT id FROM print_jobs WHERE status='queued' AND available_at<=?
                    AND (? IS NULL OR id=?)
                    AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)
                    AND attempts<? AND cleanup_status='none'
                    AND EXISTS (SELECT 1 FROM printer_heartbeats WHERE runner_id=? AND health='ready'
                        AND settings_protocol>=?
                        AND seen_at>=? AND ((settings_protocol>=3 AND copies<=?) OR
                            (settings_protocol=2 AND copies<=? AND orientation='portrait') OR
                            (settings_protocol=1 AND copies<=3 AND orientation='portrait') OR
                            (settings_protocol=0 AND copies<=3 AND orientation='portrait' AND paper_size='A4'
                                AND color_mode='monochrome' AND duplex='simplex')))
                    ORDER BY created_at,id LIMIT 1)
                AND status='queued' RETURNING *`).bind(runnerId, leaseTokenHash, leaseUntil, now, now, jobId, jobId, uatExpiresAt, uatExpiresAt, 3, runnerId, minimumProtocol, (/* @__PURE__ */ new Date(Date.parse(now) - 6e4)).toISOString(), limits.maxCopies, limits.maxCopies).first();
		},
		findLease: ({ id, tokenHash, now }) => database.prepare(`SELECT * FROM print_jobs
            WHERE id=? AND status IN ('leased','ready','submission_started') AND lease_token_hash=?
            AND lease_until>? AND cleanup_status='none'`).bind(id, tokenHash, now).first(),
		markReady: async ({ id, tokenHash, now, pageCount, maxPageCopies = 200, uatExpiresAt = null }) => {
			return (await database.prepare(`UPDATE print_jobs SET status='ready',page_count=?,updated_at=?
                WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>? AND cleanup_status='none'
                AND ? * copies <= ?
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)`).bind(pageCount, now, id, tokenHash, now, pageCount, maxPageCopies, uatExpiresAt, uatExpiresAt).run()).meta.changes === 1;
		},
		markValidationFailed: async ({ id, tokenHash, now, resultCode }) => {
			return (await database.prepare(`UPDATE print_jobs SET status='failed',result_code=?,updated_at=?,
                expires_at=? WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>?`).bind(resultCode, now, addMilliseconds(now, PRINT_FAILURE_RETENTION_MS), id, tokenHash, now).run()).meta.changes === 1;
		},
		touchLease: async ({ id, tokenHash, now }) => {
			return (await database.prepare(`UPDATE print_jobs SET lease_until=?,updated_at=?
                WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>?`).bind(addMilliseconds(now, PRINT_LEASE_MS), now, id, tokenHash, now).run()).meta.changes === 1;
		},
		markSubmissionStarted: async ({ id, tokenHash, now, uatExpiresAt = null }) => {
			return (await database.prepare(`UPDATE print_jobs SET status='submission_started',
                submission_started_at=?,updated_at=? WHERE id=? AND status='ready'
                AND lease_token_hash=? AND lease_until>? AND cleanup_status='none'
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)`).bind(now, now, id, tokenHash, now, uatExpiresAt, uatExpiresAt).run()).meta.changes === 1;
		},
		async recordResult({ id, tokenHash, now, result }) {
			const resultTime = result.status === "submitted" ? addMilliseconds(now, PRINT_SUCCESS_RETENTION_MS) : addMilliseconds(now, PRINT_FAILURE_RETENTION_MS);
			if ((await database.prepare(`UPDATE print_jobs SET status=?,result_code=?,spooler_job_id=?,
                updated_at=?,expires_at=? WHERE id=? AND status='submission_started'
                AND lease_token_hash=? AND lease_until>? AND cleanup_status='none'`).bind(result.status, result.resultCode, result.spoolerJobId, now, resultTime, id, tokenHash, now).run()).meta.changes === 1) return true;
			const existing = await database.prepare(`SELECT status,result_code FROM print_jobs
                WHERE id=? AND lease_token_hash=?`).bind(id, tokenHash).first();
			return existing?.status === result.status && existing.result_code === result.resultCode;
		},
		async heartbeat(input) {
			await database.prepare(`INSERT INTO printer_heartbeats(
                printer_id,runner_id,health,printer_name,seen_at,settings_protocol
            ) VALUES(?,?,?,?,?,?) ON CONFLICT(printer_id) DO UPDATE SET runner_id=excluded.runner_id,
                health=excluded.health,printer_name=excluded.printer_name,seen_at=excluded.seen_at,
                settings_protocol=excluded.settings_protocol`).bind(input.printerId, input.runnerId, input.health, input.printerName, input.now, input.settingsProtocol || 0).run();
		},
		async readStaffStatus(now) {
			const [heartbeat, jobs] = await Promise.all([database.prepare(`SELECT printer_id,runner_id,health,printer_name,seen_at FROM printer_heartbeats
                    ORDER BY seen_at DESC LIMIT 1`).first(), database.prepare(`SELECT status,count(*) AS count FROM print_jobs GROUP BY status`).all()]);
			const heartbeatAge = heartbeat ? Date.parse(now) - Date.parse(heartbeat.seen_at) : Infinity;
			const online = Boolean(heartbeat && heartbeat.health === "ready" && heartbeatAge >= -3e4 && heartbeatAge <= 6e4);
			return {
				printer: heartbeat ? {
					...heartbeat,
					online
				} : { online: false },
				jobs: jobs.results
			};
		},
		findByTrackingHash: (hash) => database.prepare(`SELECT status FROM print_jobs
            WHERE tracking_token_hash=? AND purge_after>?`).bind(hash, (/* @__PURE__ */ new Date()).toISOString()).first(),
		listSubmissionStarted: (runnerId) => database.prepare(`SELECT id,submission_started_at,spooler_job_id
            FROM print_jobs WHERE status='submission_started' AND runner_id=? ORDER BY submission_started_at`).bind(runnerId).all().then((result) => result.results),
		async reconcile(now) {
			const expiredLeaseTime = new Date(Date.parse(now) - PRINT_LEASE_MS).toISOString();
			await database.batch([
				database.prepare(`UPDATE print_jobs SET status=CASE WHEN attempts<? THEN 'queued' ELSE 'failed' END,
                    result_code='lease_expired',lease_token_hash=NULL,lease_until=NULL,runner_id=NULL,updated_at=?
                    WHERE status IN ('leased','ready') AND lease_until<=? AND submission_started_at IS NULL
                    AND cleanup_status='none'`).bind(3, now, now),
				database.prepare(`UPDATE print_jobs SET status='unknown',result_code='submission_unknown',updated_at=?
                    WHERE status='submission_started' AND submission_started_at<=? AND cleanup_status='none'`).bind(now, expiredLeaseTime),
				database.prepare(`UPDATE print_jobs SET status='expired',lease_token_hash=NULL,lease_until=NULL,updated_at=?
                    WHERE status IN ('uploading','queued','leased','ready') AND expires_at<=?
                    AND submission_started_at IS NULL AND cleanup_status='none'`).bind(now, now),
				database.prepare(`UPDATE print_jobs SET cleanup_status='pending',updated_at=? WHERE expires_at<=?
                    AND status IN ('expired','failed','unknown','submitted','cancelled') AND cleanup_status='none'`).bind(now, now),
				database.prepare(`UPDATE print_jobs SET cleanup_status='complete',storage_deleted_at=?,updated_at=?
                    WHERE cleanup_status='pending' AND storage_key IS NULL`).bind(now, now)
			]);
			return (await database.prepare(`SELECT id,storage_key FROM print_jobs WHERE cleanup_status='pending'
                AND storage_key IS NOT NULL ORDER BY expires_at LIMIT 50`).all()).results;
		},
		async markObjectDeleted({ id, now }) {
			return (await database.prepare(`UPDATE print_jobs SET storage_key=NULL,cleanup_status='complete',
                storage_deleted_at=?,upload_token_hash=NULL,updated_at=? WHERE id=? AND cleanup_status='pending'`).bind(now, now, id).run()).meta.changes === 1;
		},
		async incrementCleanupAttempt({ id, now }) {
			await database.prepare(`UPDATE print_jobs SET cleanup_attempts=cleanup_attempts+1,updated_at=?
                WHERE id=? AND cleanup_status='pending'`).bind(now, id).run();
		},
		purgeOldRows: async (now) => database.prepare(`DELETE FROM print_jobs
            WHERE cleanup_status='complete' AND purge_after<=?`).bind(now).run()
	});
}
//#endregion
//#region src/server/repositories/d1/print-uat-repository.js
/**
* Atomically consume the persistent v7 UAT slot before creating its single job.
* @param {object} database D1 binding.
* @param {{jobId: string, now: string}} reservation Safe reservation metadata.
* @returns {Promise<boolean>} Whether this request reserved the slot.
*/
async function reservePrintUatSlot(database, reservation) {
	const recorded = await database.prepare(`INSERT INTO audit_events (
        id,event_type,actor_type,request_id,safe_metadata_json,created_at
    ) VALUES (?, 'print.uat_slot_reserved', 'system', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING RETURNING id`).bind(PRINT_UAT_SLOT_ID, reservation.jobId, JSON.stringify({ job_id: reservation.jobId }), reservation.now).first();
	return Boolean(recorded);
}
/**
* Read the reserved job without disclosing tokens or document contents.
* @param {object} database D1 binding.
* @returns {Promise<string|null>} Reserved job ID, including after print-row cleanup.
*/
async function readPrintUatJobId(database) {
	return (await database.prepare(`SELECT json_extract(safe_metadata_json, '$.job_id') AS job_id
        FROM audit_events WHERE id=? AND event_type='print.uat_slot_reserved'`).bind("staff-print-uat-v7").first())?.job_id || null;
}
//#endregion
//#region src/server/services/print-uat-job.js
/**
* Restrict UAT browser and machine work to the single persistent reservation.
* @param {string} jobId Requested job ID.
* @param {object} environment Worker bindings.
* @returns {Promise<void>}
* @throws {ApiError} When the requested job is outside the UAT reservation.
*/
async function requirePrintUatJob(jobId, environment) {
	if (!readPrintUatIdempotencyScope(environment)) return;
	if (await readPrintUatJobId(environment.DB) !== jobId) throw new ApiError(403, "PRINT_UAT_JOB_INVALID", "UAT işi doğrulanamadı.");
}
//#endregion
//#region node_modules/aws4fetch/dist/aws4fetch.esm.mjs
/**
* @license MIT <https://opensource.org/licenses/MIT>
* @copyright Michael Hart 2024
*/
var encoder$1 = new TextEncoder();
var HOST_SERVICES = {
	appstream2: "appstream",
	cloudhsmv2: "cloudhsm",
	email: "ses",
	marketplace: "aws-marketplace",
	mobile: "AWSMobileHubService",
	pinpoint: "mobiletargeting",
	queue: "sqs",
	"git-codecommit": "codecommit",
	"mturk-requester-sandbox": "mturk-requester",
	"personalize-runtime": "personalize"
};
var UNSIGNABLE_HEADERS = /* @__PURE__ */ new Set([
	"authorization",
	"content-type",
	"content-length",
	"user-agent",
	"presigned-expires",
	"expect",
	"x-amzn-trace-id",
	"range",
	"connection"
]);
var AwsClient = class {
	constructor({ accessKeyId, secretAccessKey, sessionToken, service, region, cache, retries, initRetryMs }) {
		if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
		if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
		this.accessKeyId = accessKeyId;
		this.secretAccessKey = secretAccessKey;
		this.sessionToken = sessionToken;
		this.service = service;
		this.region = region;
		this.cache = cache || /* @__PURE__ */ new Map();
		this.retries = retries != null ? retries : 10;
		this.initRetryMs = initRetryMs || 50;
	}
	async sign(input, init) {
		if (input instanceof Request) {
			const { method, url, headers, body } = input;
			init = Object.assign({
				method,
				url,
				headers
			}, init);
			if (init.body == null && headers.has("Content-Type")) init.body = body != null && headers.has("X-Amz-Content-Sha256") ? body : await input.clone().arrayBuffer();
			input = url;
		}
		const signer = new AwsV4Signer(Object.assign({ url: input.toString() }, init, this, init && init.aws));
		const signed = Object.assign({}, init, await signer.sign());
		delete signed.aws;
		try {
			return new Request(signed.url.toString(), signed);
		} catch (e) {
			if (e instanceof TypeError) return new Request(signed.url.toString(), Object.assign({ duplex: "half" }, signed));
			throw e;
		}
	}
	async fetch(input, init) {
		for (let i = 0; i <= this.retries; i++) {
			const fetched = fetch(await this.sign(input, init));
			if (i === this.retries) return fetched;
			const res = await fetched;
			if (res.status < 500 && res.status !== 429) return res;
			await new Promise((resolve) => setTimeout(resolve, Math.random() * this.initRetryMs * Math.pow(2, i)));
		}
		throw new Error("An unknown error occurred, ensure retries is not negative");
	}
};
var AwsV4Signer = class {
	constructor({ method, url, headers, body, accessKeyId, secretAccessKey, sessionToken, service, region, cache, datetime, signQuery, appendSessionToken, allHeaders, singleEncode }) {
		if (url == null) throw new TypeError("url is a required option");
		if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
		if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
		this.method = method || (body ? "POST" : "GET");
		this.url = new URL(url);
		this.headers = new Headers(headers || {});
		this.body = body;
		this.accessKeyId = accessKeyId;
		this.secretAccessKey = secretAccessKey;
		this.sessionToken = sessionToken;
		let guessedService, guessedRegion;
		if (!service || !region) [guessedService, guessedRegion] = guessServiceRegion(this.url, this.headers);
		this.service = service || guessedService || "";
		this.region = region || guessedRegion || "us-east-1";
		this.cache = cache || /* @__PURE__ */ new Map();
		this.datetime = datetime || (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
		this.signQuery = signQuery;
		this.appendSessionToken = appendSessionToken || this.service === "iotdevicegateway";
		this.headers.delete("Host");
		if (this.service === "s3" && !this.signQuery && !this.headers.has("X-Amz-Content-Sha256")) this.headers.set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD");
		const params = this.signQuery ? this.url.searchParams : this.headers;
		params.set("X-Amz-Date", this.datetime);
		if (this.sessionToken && !this.appendSessionToken) params.set("X-Amz-Security-Token", this.sessionToken);
		this.signableHeaders = ["host", ...this.headers.keys()].filter((header) => allHeaders || !UNSIGNABLE_HEADERS.has(header)).sort();
		this.signedHeaders = this.signableHeaders.join(";");
		this.canonicalHeaders = this.signableHeaders.map((header) => header + ":" + (header === "host" ? this.url.host : (this.headers.get(header) || "").replace(/\s+/g, " "))).join("\n");
		this.credentialString = [
			this.datetime.slice(0, 8),
			this.region,
			this.service,
			"aws4_request"
		].join("/");
		if (this.signQuery) {
			if (this.service === "s3" && !params.has("X-Amz-Expires")) params.set("X-Amz-Expires", "86400");
			params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
			params.set("X-Amz-Credential", this.accessKeyId + "/" + this.credentialString);
			params.set("X-Amz-SignedHeaders", this.signedHeaders);
		}
		if (this.service === "s3") try {
			this.encodedPath = decodeURIComponent(this.url.pathname.replace(/\+/g, " "));
		} catch (e) {
			this.encodedPath = this.url.pathname;
		}
		else this.encodedPath = this.url.pathname.replace(/\/+/g, "/");
		if (!singleEncode) this.encodedPath = encodeURIComponent(this.encodedPath).replace(/%2F/g, "/");
		this.encodedPath = encodeRfc3986(this.encodedPath);
		const seenKeys = /* @__PURE__ */ new Set();
		this.encodedSearch = [...this.url.searchParams].filter(([k]) => {
			if (!k) return false;
			if (this.service === "s3") {
				if (seenKeys.has(k)) return false;
				seenKeys.add(k);
			}
			return true;
		}).map((pair) => pair.map((p) => encodeRfc3986(encodeURIComponent(p)))).sort(([k1, v1], [k2, v2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0).map((pair) => pair.join("=")).join("&");
	}
	async sign() {
		if (this.signQuery) {
			this.url.searchParams.set("X-Amz-Signature", await this.signature());
			if (this.sessionToken && this.appendSessionToken) this.url.searchParams.set("X-Amz-Security-Token", this.sessionToken);
		} else this.headers.set("Authorization", await this.authHeader());
		return {
			method: this.method,
			url: this.url,
			headers: this.headers,
			body: this.body
		};
	}
	async authHeader() {
		return [
			"AWS4-HMAC-SHA256 Credential=" + this.accessKeyId + "/" + this.credentialString,
			"SignedHeaders=" + this.signedHeaders,
			"Signature=" + await this.signature()
		].join(", ");
	}
	async signature() {
		const date = this.datetime.slice(0, 8);
		const cacheKey = [
			this.secretAccessKey,
			date,
			this.region,
			this.service
		].join();
		let kCredentials = this.cache.get(cacheKey);
		if (!kCredentials) {
			kCredentials = await hmac(await hmac(await hmac(await hmac("AWS4" + this.secretAccessKey, date), this.region), this.service), "aws4_request");
			this.cache.set(cacheKey, kCredentials);
		}
		return buf2hex(await hmac(kCredentials, await this.stringToSign()));
	}
	async stringToSign() {
		return [
			"AWS4-HMAC-SHA256",
			this.datetime,
			this.credentialString,
			buf2hex(await hash(await this.canonicalString()))
		].join("\n");
	}
	async canonicalString() {
		return [
			this.method.toUpperCase(),
			this.encodedPath,
			this.encodedSearch,
			this.canonicalHeaders + "\n",
			this.signedHeaders,
			await this.hexBodyHash()
		].join("\n");
	}
	async hexBodyHash() {
		let hashHeader = this.headers.get("X-Amz-Content-Sha256") || (this.service === "s3" && this.signQuery ? "UNSIGNED-PAYLOAD" : null);
		if (hashHeader == null) {
			if (this.body && typeof this.body !== "string" && !("byteLength" in this.body)) throw new Error("body must be a string, ArrayBuffer or ArrayBufferView, unless you include the X-Amz-Content-Sha256 header");
			hashHeader = buf2hex(await hash(this.body || ""));
		}
		return hashHeader;
	}
};
async function hmac(key, string) {
	const cryptoKey = await crypto.subtle.importKey("raw", typeof key === "string" ? encoder$1.encode(key) : key, {
		name: "HMAC",
		hash: { name: "SHA-256" }
	}, false, ["sign"]);
	return crypto.subtle.sign("HMAC", cryptoKey, encoder$1.encode(string));
}
async function hash(content) {
	return crypto.subtle.digest("SHA-256", typeof content === "string" ? encoder$1.encode(content) : content);
}
var HEX_CHARS = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"a",
	"b",
	"c",
	"d",
	"e",
	"f"
];
function buf2hex(arrayBuffer) {
	const buffer = new Uint8Array(arrayBuffer);
	let out = "";
	for (let idx = 0; idx < buffer.length; idx++) {
		const n = buffer[idx];
		out += HEX_CHARS[n >>> 4 & 15];
		out += HEX_CHARS[n & 15];
	}
	return out;
}
function encodeRfc3986(urlEncodedStr) {
	return urlEncodedStr.replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function guessServiceRegion(url, headers) {
	const { hostname, pathname } = url;
	if (hostname.endsWith(".on.aws")) {
		const match = hostname.match(/^[^.]{1,63}\.lambda-url\.([^.]{1,63})\.on\.aws$/);
		return match != null ? ["lambda", match[1] || ""] : ["", ""];
	}
	if (hostname.endsWith(".r2.cloudflarestorage.com")) return ["s3", "auto"];
	if (hostname.endsWith(".backblazeb2.com")) {
		const match = hostname.match(/^(?:[^.]{1,63}\.)?s3\.([^.]{1,63})\.backblazeb2\.com$/);
		return match != null ? ["s3", match[1] || ""] : ["", ""];
	}
	const match = hostname.replace("dualstack.", "").match(/([^.]{1,63})\.(?:([^.]{0,63})\.)?amazonaws\.com(?:\.cn)?$/);
	let service = match && match[1] || "";
	let region = match && match[2];
	if (region === "us-gov") region = "us-gov-west-1";
	else if (region === "s3" || region === "s3-accelerate") {
		region = "us-east-1";
		service = "s3";
	} else if (service === "iot") {
		if (hostname.startsWith("iot.")) service = "execute-api";
		else if (hostname.startsWith("data.jobs.iot.")) service = "iot-jobs-data";
		else service = pathname === "/mqtt" ? "iotdevicegateway" : "iotdata";
	} else if (service === "autoscaling") {
		const targetPrefix = (headers.get("X-Amz-Target") || "").split(".")[0];
		if (targetPrefix === "AnyScaleFrontendService") service = "application-autoscaling";
		else if (targetPrefix === "AnyScaleScalingPlannerFrontendService") service = "autoscaling-plans";
	} else if (region == null && service.startsWith("s3-")) {
		region = service.slice(3).replace(/^fips-|^external-1/, "");
		service = "s3";
	} else if (service.endsWith("-fips")) service = service.slice(0, -5);
	else if (region && /-\d$/.test(service) && !/-\d$/.test(region)) [service, region] = [region, service];
	return [HOST_SERVICES[service] || service, region || ""];
}
//#endregion
//#region src/server/storage/printStorage.js
var PRINT_KEY_PATTERN = /^print\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var MAX_CAPABILITY_SECONDS = 300;
function assertPrintKey(key) {
	if (typeof key !== "string" || !PRINT_KEY_PATTERN.test(key)) throw new TypeError("Invalid print storage key.");
}
function createSigner$1(config) {
	if (!config.accountId || !config.bucketName || !config.accessKeyId || !config.secretAccessKey) throw new ApiError(503, "PRINT_UNAVAILABLE", "Yazdırma hizmeti şu anda kullanılamıyor.", true);
	return new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		region: "auto"
	});
}
function createPrintStorage(bucket, config = {}) {
	if (!bucket) throw new TypeError("A private print bucket binding is required.");
	let signer;
	const readSigner = () => signer || (signer = createSigner$1(config));
	return Object.freeze({
		async createUploadCapability(key, { contentType, expiresInSeconds = MAX_CAPABILITY_SECONDS }) {
			assertPrintKey(key);
			if (![
				"application/pdf",
				"image/jpeg",
				"image/png"
			].includes(contentType)) throw new TypeError("Unsupported print content type.");
			if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 30 || expiresInSeconds > MAX_CAPABILITY_SECONDS) throw new TypeError("Invalid print capability lifetime.");
			const url = new URL(`https://${config.accountId}.r2.cloudflarestorage.com`);
			url.pathname = `/${config.bucketName}/${key}`;
			url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
			const request = new Request(url, {
				method: "PUT",
				headers: {
					"content-type": contentType,
					"if-none-match": "*"
				}
			});
			return {
				url: (await readSigner().sign(request, { aws: {
					signQuery: true,
					allHeaders: true
				} })).url,
				method: "PUT",
				expiresInSeconds,
				requiredHeaders: {
					"Content-Type": contentType,
					"If-None-Match": "*"
				}
			};
		},
		head(key) {
			assertPrintKey(key);
			return bucket.head(key);
		},
		get(key) {
			assertPrintKey(key);
			return bucket.get(key);
		},
		async delete(key) {
			assertPrintKey(key);
			await bucket.delete(key);
		}
	});
}
//#endregion
//#region src/server/http/requestBody.js
/**
* Parses a bounded JSON request body for an API route.
* @param {Request} request Fetch API request.
* @param {number} [maxBytes] Maximum UTF-8 body size.
* @returns {Promise<Record<string, unknown>>} Parsed object body.
* @throws {ApiError} When the body is missing, invalid, or exceeds the limit.
*/
async function readJsonBody(request, maxBytes = 16384) {
	if (Number(request.headers.get("Content-Length") || 0) > maxBytes) throw new ApiError(413, "REQUEST_TOO_LARGE", "İstek boyutu izin verilen sınırı aşıyor.");
	const bodyText = await request.text();
	if (new TextEncoder().encode(bodyText).length > maxBytes) throw new ApiError(413, "REQUEST_TOO_LARGE", "İstek boyutu izin verilen sınırı aşıyor.");
	try {
		const body = JSON.parse(bodyText);
		if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("Expected JSON object.");
		return body;
	} catch {
		throw new ApiError(400, "VALIDATION_ERROR", "İstek bilgileri okunamadı. Alanları kontrol edip tekrar deneyin.");
	}
}
//#endregion
//#region src/server/security/origin.js
/**
* Confirms a state-changing request originated from the same origin.
* @param {Request} request Fetch API request.
* @returns {boolean} Whether the supplied Origin matches the request URL.
*/
function isSameOriginRequest(request) {
	const originHeader = request.headers.get("Origin");
	if (!originHeader) return false;
	try {
		const origin = new URL(originHeader);
		const requestUrl = new URL(request.url);
		return origin.origin === requestUrl.origin;
	} catch {
		return false;
	}
}
//#endregion
//#region src/server/security/requestRateLimit.js
async function hashValue$2(value) {
	const encoded = new TextEncoder().encode(value);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/**
* Consumes one hashed request-rate slot without storing the source IP in D1.
* @param {{consume(input: object): Promise<object|null>}} repository Rate-limit repository.
* @param {object} options Endpoint and limit window.
* @returns {Promise<boolean>} Whether the request remains below its configured limit.
*/
async function consumePublicRateLimit(repository, { endpoint, identity, nowSeconds, windowSeconds, maxRequests }) {
	const requestKeyHash = await hashValue$2(identity);
	const rateLimit = await repository.consume({
		endpoint,
		requestKeyHash,
		nowSeconds,
		windowSeconds,
		maxRequests
	});
	return rateLimit.request_count <= maxRequests && !(rateLimit.blocked_until > nowSeconds);
}
//#endregion
//#region src/server/routes/shared.js
/**
* Requires an exact HTTP method for the current route.
* @param {Request} request Fetch API request.
* @param {string} method Allowed method.
* @returns {void} Nothing when the method matches.
* @throws {ApiError} When the request method is not allowed.
*/
function requireMethod(request, method) {
	if (request.method === method) return;
	throw new ApiError(405, "METHOD_NOT_ALLOWED", "Bu istek yöntemi desteklenmiyor.");
}
/**
* Rejects browser mutations without a same-origin request context.
* @param {Request} request Fetch API request.
* @returns {void} Nothing when the request origin is valid.
* @throws {ApiError} When the request is cross-origin or cannot be verified.
*/
function requireSameOrigin(request) {
	if (isSameOriginRequest(request)) return;
	throw new ApiError(403, "CROSS_ORIGIN_REQUEST", "İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.");
}
/**
* Creates repository adapters from the current Worker D1 binding.
* @param {object} environment Worker bindings.
* @returns {object} D1 repository collection.
* @throws {ApiError} When D1 is not configured.
*/
function createRepositories(environment) {
	if (!environment.DB) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.", true);
	return createD1Repositories(environment.DB);
}
/**
* Trims and bounds-checks a required text field.
* @param {unknown} value Input value.
* @param {{field: string, minLength?: number, maxLength?: number}} options Field label and length limits.
* @returns {string} Validated trimmed text.
* @throws {ApiError} When the value is not valid text.
*/
function requireText(value, { field, minLength = 1, maxLength = 255 }) {
	if (typeof value !== "string") throw new ApiError(400, "VALIDATION_ERROR", `${field} alanını kontrol edip tekrar deneyin.`);
	const normalizedValue = value.trim();
	if (normalizedValue.length < minLength || normalizedValue.length > maxLength) throw new ApiError(400, "VALIDATION_ERROR", `${field} alanını kontrol edip tekrar deneyin.`);
	return normalizedValue;
}
/**
* Persists an audit event through the configured repository.
* @param {object} repositories D1 repository collection.
* @param {object} event Safe event fields and correlation ID.
* @returns {Promise<void>} Resolves after the event is stored.
*/
function createAuditEvent(repositories, { eventType, actorType, actorStaffId = null, applicationId = null, requestId, metadata = {} }) {
	return repositories.audit.writeEvent({
		id: crypto.randomUUID(),
		eventType,
		actorType,
		actorStaffId,
		applicationId,
		requestId,
		metadata
	});
}
/**
* Applies an address-keyed public route rate limit.
* @param {object} repositories D1 repository collection.
* @param {Request} request Fetch API request.
* @param {{endpoint: string, maxRequests: number, windowSeconds: number}} options Rate limit policy.
* @returns {Promise<void>} Resolves when the request is within the limit.
* @throws {ApiError} When the request has exceeded its limit.
*/
async function enforceRateLimit(repositories, request, { endpoint, maxRequests, windowSeconds }) {
	const clientAddress = request.headers.get("CF-Connecting-IP") || "unknown-client";
	const nowSeconds = Math.floor(Date.now() / 1e3);
	if (!await consumePublicRateLimit(repositories.rateLimits, {
		endpoint,
		identity: clientAddress,
		nowSeconds,
		maxRequests,
		windowSeconds
	})) throw new ApiError(429, "RATE_LIMITED", "Çok fazla istek yapıldı. Bir süre sonra tekrar deneyin.", true);
}
//#endregion
//#region src/server/routes/printRoutes.js
function hashValue$1(value) {
	return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}
function requireToken(value) {
	if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) return value;
	throw new ApiError(400, "INVALID_PRINT_INPUT", "Yazdırma isteği doğrulanamadı.");
}
function createStorage(environment) {
	if (!environment.PRINT_FILES || !environment.R2_ACCOUNT_ID || !environment.PRINT_BUCKET_NAME || !environment.PRINT_R2_ACCESS_KEY_ID || !environment.PRINT_R2_SECRET_ACCESS_KEY) throw new ApiError(503, "PRINT_UNAVAILABLE", "Yazdırma şu anda kullanılamıyor.", true);
	return createPrintStorage(environment.PRINT_FILES, {
		accountId: environment.R2_ACCOUNT_ID,
		bucketName: environment.PRINT_BUCKET_NAME,
		accessKeyId: environment.PRINT_R2_ACCESS_KEY_ID,
		secretAccessKey: environment.PRINT_R2_SECRET_ACCESS_KEY
	});
}
async function readPublicPrintStatus(request, environment) {
	requireMethod(request, "GET");
	if (!isPrintEnabled(environment)) return {
		available: false,
		options: readPrintOptionCapabilities(environment)
	};
	const repository = createPrintRepository(environment.DB);
	await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request, {
		endpoint: "print-status",
		maxRequests: 60,
		windowSeconds: 60
	});
	const limits = readPrintLimits(environment);
	const status = await repository.readPublicStatus((/* @__PURE__ */ new Date()).toISOString(), limits);
	const options = readPrintOptionCapabilities(environment, status.settingsProtocol);
	if (!limits.isValid || !environment.PRINT_FILES || !environment.R2_ACCOUNT_ID || !environment.PRINT_BUCKET_NAME || !environment.PRINT_R2_ACCESS_KEY_ID || !environment.PRINT_R2_SECRET_ACCESS_KEY) return {
		available: false,
		options
	};
	return {
		available: status.available,
		options,
		limits: status.limits
	};
}
async function readPrintUpload(request, environment, repository) {
	const body = await readJsonBody(request, 2048);
	const allowedKeys = [
		"byte_size",
		"color_mode",
		"copies",
		"duplex",
		"idempotency_key",
		"media_type",
		"orientation",
		"paper_size",
		"tracking_token",
		"upload_token"
	];
	if (Object.keys(body).length !== allowedKeys.length || Object.keys(body).some((key) => !allowedKeys.includes(key))) throw new ApiError(400, "INVALID_PRINT_INPUT", "Yazdırma isteği doğrulanamadı.");
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const limits = readPrintLimits(environment);
	if (!limits.isValid) throw new ApiError(503, "PRINT_UNAVAILABLE", "Yazdırma şu anda kullanılamıyor.", true);
	const upload = validatePrintUpload(body, readPrintOptionCapabilities(environment, (await repository.readPublicStatus(now, limits)).settingsProtocol));
	requirePrintUatUpload(body, environment);
	return {
		now,
		upload,
		idempotencyKey: requireToken(body.idempotency_key),
		uploadToken: requireToken(body.upload_token),
		trackingToken: requireToken(body.tracking_token)
	};
}
async function requireUatReservation(environment, reservation) {
	if (!readPrintUatPolicy(environment)) return;
	if (await reservePrintUatSlot(environment.DB, reservation)) return;
	if (await createPrintRepository(environment.DB).findByIdempotencyHash(reservation.idempotencyHash)) return;
	throw new ApiError(503, "PRINT_UAT_EXHAUSTED", "Tek UAT işi hakkı kullanıldı.");
}
async function preparePrintIntent(request, environment, context) {
	const { upload, now } = context;
	const id = crypto.randomUUID();
	const idempotencyHash = await hashValue$1(readPrintUatIdempotencyScope(environment) || context.idempotencyKey);
	if (readPrintUatPolicy(environment)) await requireStaff(request, environment, ["reviewer", "admin"]);
	await requireUatReservation(environment, {
		jobId: id,
		idempotencyHash,
		now
	});
	return {
		id,
		idempotencyHash,
		uploadTokenHash: await hashValue$1(context.uploadToken),
		trackingTokenHash: await hashValue$1(context.trackingToken),
		storageKey: `print/${id}`,
		mediaType: upload.mediaType,
		byteSize: upload.byteSize,
		copies: upload.copies,
		paperSize: upload.paperSize,
		colorMode: upload.colorMode,
		duplex: upload.duplex,
		orientation: upload.orientation,
		requiredProtocol: upload.requiredProtocol,
		now,
		expiresAt: new Date(Date.parse(now) + PRINT_UPLOAD_TTL_MS).toISOString(),
		purgeAfter: new Date(Date.parse(now) + PRINT_ROW_RETENTION_MS).toISOString(),
		heartbeatCutoff: new Date(Date.parse(now) - PRINT_HEARTBEAT_MAX_AGE_MS).toISOString(),
		uatExpiresAt: readPrintUatDeadline(environment)
	};
}
function createUatUploadCapability(jobId, uploadToken) {
	return {
		url: `/api/public/print/jobs/${jobId}/upload`,
		method: "PUT",
		requiredHeaders: {
			"Content-Type": "application/pdf",
			"X-Print-Upload-Token": uploadToken
		}
	};
}
/**
* Create an ordinary upload intent or the single authenticated UAT reservation.
* @param {Request} request Same-origin browser POST.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Job state and its upload instructions.
* @throws {ApiError} When input, availability or UAT authorization is invalid.
*/
async function createPublicPrintUploadIntent(request, environment) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const storage = createStorage(environment);
	const repository = createPrintRepository(environment.DB);
	await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request, {
		endpoint: "print-upload",
		maxRequests: 5,
		windowSeconds: 300
	});
	const context = await readPrintUpload(request, environment, repository);
	const intent = await preparePrintIntent(request, environment, context);
	const job = await repository.createUploadIntent(intent);
	if (!job) throw new ApiError(503, "PRINT_UNAVAILABLE", "Yazdırma şu anda kullanılamıyor.", true);
	readPrintUatDeadline(environment);
	if (job.status !== "uploading") return {
		job_id: job.id,
		status: job.status,
		upload: null
	};
	const capability = intent.uatExpiresAt ? createUatUploadCapability(job.id, context.uploadToken) : await storage.createUploadCapability(job.storage_key, { contentType: job.media_type });
	return {
		job_id: job.id,
		status: job.status,
		upload: capability
	};
}
async function readVerifiedPrintBytes(storage, job) {
	const object = await storage.head(job.storage_key);
	if (!object || object.size !== job.byte_size || object.httpMetadata?.contentType !== job.media_type) throw new ApiError(409, "PRINT_UPLOAD_INVALID", "Dosya doğrulanamadı. Dosyayı yeniden seçin.");
	const content = await storage.get(job.storage_key);
	if (!content || typeof content.arrayBuffer !== "function" || content.size !== job.byte_size) throw new ApiError(409, "PRINT_UPLOAD_INVALID", "Dosyayı yeniden seçin.");
	const bytes = new Uint8Array(await content.arrayBuffer());
	if (bytes.length > 10485760 || !validatePrintMagicBytes(job.media_type, bytes)) throw new ApiError(415, "PRINT_UPLOAD_INVALID", "PDF, JPG veya PNG dosyası seçin.");
	return bytes;
}
/**
* Verify uploaded bytes before queueing; UAT rechecks the fixture and staff session.
* @param {Request} request Same-origin browser POST with upload token.
* @param {object} environment Worker bindings.
* @param {string} jobId Opaque job ID.
* @returns {Promise<object>} Queued job acknowledgement.
* @throws {ApiError} When tokens, bytes, authorization or expiry checks fail.
*/
async function finalizePublicPrintUpload(request, environment, jobId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	await requirePrintUatJob(jobId, environment);
	const storage = createStorage(environment);
	const repository = createPrintRepository(environment.DB);
	await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request, {
		endpoint: "print-finalize",
		maxRequests: 10,
		windowSeconds: 300
	});
	const tokenHash = await hashValue$1(requireToken(request.headers.get("X-Print-Upload-Token")));
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const job = await repository.findUploadIntent({
		id: jobId,
		tokenHash,
		now
	});
	if (!job) throw new ApiError(404, "PRINT_JOB_NOT_FOUND", "Yazdırma isteği bulunamadı.");
	await requirePrintUatContent(await readVerifiedPrintBytes(storage, job), environment);
	if (readPrintUatPolicy(environment)) await requireStaff(request, environment, ["reviewer", "admin"]);
	if (!await repository.markQueued({
		id: job.id,
		tokenHash,
		now,
		expiresAt: new Date(Date.parse(now) + 36e5).toISOString(),
		uatExpiresAt: readPrintUatDeadline(environment)
	})) throw new ApiError(503, "PRINT_UNAVAILABLE", "Yazdırma şu anda kullanılamıyor.", true);
	return {
		job_id: job.id,
		status: "queued"
	};
}
async function readPublicPrintJobStatus(request, environment) {
	requireMethod(request, "GET");
	await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request, {
		endpoint: "print-job-status",
		maxRequests: 120,
		windowSeconds: 60
	});
	const tokenHash = await hashValue$1(requireToken(request.headers.get("X-Print-Tracking-Token")));
	const job = await createPrintRepository(environment.DB).findByTrackingHash(tokenHash);
	if (!job) throw new ApiError(404, "PRINT_JOB_NOT_FOUND", "Yazdırma isteği bulunamadı.");
	return { status: job.status };
}
//#endregion
//#region src/server/routes/print-uat-routes.js
function requireActiveUat(environment) {
	const policy = readPrintUatPolicy(environment);
	if (!policy) throw new ApiError(503, "PRINT_DISABLED", "Yazdırma şu anda kapalı.", true);
	return policy;
}
async function readUatUpload(request, environment, jobId) {
	if (await readPrintUatJobId(environment.DB) !== jobId) throw invalidUpload();
	const token = request.headers.get("X-Print-Upload-Token");
	if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw invalidUpload();
	const tokenHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	const job = await createPrintRepository(environment.DB).findUploadIntent({
		id: jobId,
		tokenHash,
		now: (/* @__PURE__ */ new Date()).toISOString()
	});
	if (!job) throw invalidUpload();
	return job;
}
async function readUploadBytes(request, expectedSize) {
	if (request.headers.get("Content-Type") !== "application/pdf" || !request.body) throw invalidUpload();
	const reader = request.body.getReader();
	const bytes = new Uint8Array(expectedSize);
	let received = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		if (received + chunk.value.length > expectedSize) {
			await reader.cancel();
			throw invalidUpload();
		}
		bytes.set(chunk.value, received);
		received += chunk.value.length;
	}
	if (received !== expectedSize) throw invalidUpload();
	return bytes;
}
/**
* Read staff-only UAT capabilities while normal public status remains disabled.
* @param {Request} request Staff GET request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Private one-copy capabilities.
* @throws {ApiError} When the staff session or UAT window is invalid.
*/
async function readStaffPrintUatStatus(request, environment) {
	requireMethod(request, "GET");
	await requireStaff(request, environment, ["reviewer", "admin"]);
	requireActiveUat(environment);
	const status = await readPublicPrintStatus(request, {
		...environment,
		PRINT_ENABLED: "true",
		PRINT_MAX_COPIES_PER_JOB: "1"
	});
	return {
		...status,
		available: status.available && !await readPrintUatJobId(environment.DB)
	};
}
/**
* Upload only verified fixture bytes through the authenticated Worker, never a bearer R2 URL.
* @param {Request} request Staff PUT with upload token and PDF body.
* @param {object} environment Worker bindings.
* @param {string} jobId Reserved UAT job ID.
* @returns {Promise<{uploaded: boolean}>} Upload acknowledgement.
* @throws {ApiError} When authorization, expiry, tokens, content or replay checks fail.
*/
async function uploadPrintUatDocument(request, environment, jobId) {
	requireMethod(request, "PUT");
	requireSameOrigin(request);
	await requireStaff(request, environment, ["reviewer", "admin"]);
	requireActiveUat(environment);
	const bytes = await readUploadBytes(request, (await readUatUpload(request, environment, jobId)).byte_size);
	await requirePrintUatContent(bytes, environment);
	await requireStaff(request, environment, ["reviewer", "admin"]);
	requireActiveUat(environment);
	const current = await readUatUpload(request, environment, jobId);
	requireActiveUat(environment);
	if (!await environment.PRINT_FILES.put(current.storage_key, bytes, {
		httpMetadata: { contentType: "application/pdf" },
		onlyIf: { etagDoesNotMatch: "*" }
	})) throw new ApiError(409, "PRINT_UAT_UPLOAD_EXISTS", "UAT dosyası zaten yüklendi.");
	return { uploaded: true };
}
function invalidUpload() {
	return new ApiError(409, "PRINT_UPLOAD_INVALID", "UAT dosya yüklemesi doğrulanamadı.");
}
var RESULT_CODES = /* @__PURE__ */ new Set([
	"scanned",
	"malware",
	"engine_unavailable",
	"signature_stale",
	"update_failed",
	"scan_timeout",
	"scan_error",
	"policy_blocked",
	"download_failed",
	"content_mismatch",
	"unsupported_content"
]);
var RESULT_KEYS = /* @__PURE__ */ new Set([
	"file_id",
	"revision_id",
	"storage_key",
	"byte_size",
	"object_etag",
	"sha256",
	"outcome",
	"result_code",
	"engine_version",
	"signature_version",
	"signature_updated_at",
	"scanned_at",
	"full_scan",
	"policy_version"
]);
/** Hashes scanner credentials or content. @param {Uint8Array|string} value Input. @returns {Promise<string>} SHA-256 hex. */
async function hashScannerValue(value) {
	const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Checks an opaque machine identifier. @param {unknown} value Identifier. @returns {string} Safe identifier. @throws {ApiError} Invalid input. */
function requireScannerIdentifier(value) {
	if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value)) return value;
	throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
}
/** @returns {ApiError} Safe invalid-evidence error. */
function createInvalidResultError() {
	return new ApiError(400, "INVALID_SCAN_RESULT", "Tarama sonucu doğrulanamadı.");
}
/** @param {unknown} value UTC timestamp. @param {number} now Epoch milliseconds. @param {number} maxAge Maximum age. @returns {boolean} Within trusted time window. */
function isRecentTime(value, now, maxAge) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) return false;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) && timestamp <= now + 3e4 && timestamp >= now - maxAge;
}
/** @param {object} result Scan evidence. @param {number} now Epoch milliseconds. @returns {void} Validated engine evidence. @throws {ApiError} Incomplete or stale evidence. */
function requireEngineEvidence(result, now) {
	if (![result.engine_version, result.signature_version].every((value) => typeof value === "string" && /^[\w.+-]{1,64}$/.test(value))) throw createInvalidResultError();
	if (!isRecentTime(result.signature_updated_at, now, 864e5)) throw createInvalidResultError();
	if (result.outcome === "clean" && result.full_scan !== true || !/^[a-f0-9]{64}$/.test(result.sha256 || "")) throw createInvalidResultError();
	if (result.outcome === "clean" && result.result_code !== "scanned") throw createInvalidResultError();
	if (result.outcome === "unsafe" && result.result_code !== "malware") throw createInvalidResultError();
}
/** Validates a bounded result tied to exactly one job. @param {object} input Result, job and time. @returns {object} Valid result. @throws {ApiError} Invalid or mismatched evidence. */
function validateScannerResult({ result, job, now }) {
	if (Object.keys(result).length !== RESULT_KEYS.size || Object.keys(result).some((key) => !RESULT_KEYS.has(key))) throw createInvalidResultError();
	if (![
		"clean",
		"unsafe",
		"failed"
	].includes(result.outcome) || !RESULT_CODES.has(result.result_code)) throw createInvalidResultError();
	if (result.policy_version !== "clamav-full-v1" || typeof result.full_scan !== "boolean") throw createInvalidResultError();
	if (!isRecentTime(result.scanned_at, Date.parse(now), 3e5)) throw createInvalidResultError();
	if (result.file_id !== job.file_id || result.revision_id !== job.revision_id || result.storage_key !== job.storage_key || result.byte_size !== job.byte_size) throw createInvalidResultError();
	if (result.outcome !== "failed") {
		requireEngineEvidence(result, Date.parse(now));
		if (!job.content_sha256 || result.sha256 !== job.content_sha256 || result.object_etag !== job.object_etag) throw createInvalidResultError();
		return result;
	}
	if (["scanned", "malware"].includes(result.result_code)) throw createInvalidResultError();
	for (const value of [result.engine_version, result.signature_version]) if (value !== null && !(typeof value === "string" && /^[\w.+-]{1,64}$/.test(value))) throw createInvalidResultError();
	if (result.signature_updated_at !== null && !isRecentTime(result.signature_updated_at, Date.parse(now), 31536e6)) throw createInvalidResultError();
	if (result.sha256 !== null && result.sha256 !== job.content_sha256) throw createInvalidResultError();
	if (result.object_etag !== null && result.object_etag !== job.object_etag) throw createInvalidResultError();
	return result;
}
//#endregion
//#region src/server/repositories/d1/scanner-repository.js
var CURRENT_JOB = `EXISTS (
    SELECT 1 FROM document_revision_files AS files
    JOIN document_revisions AS revisions ON revisions.id = files.revision_id
    JOIN upload_intents AS intents ON intents.revision_file_id = files.id
    WHERE files.id = document_scan_jobs.file_id AND files.revision_id = document_scan_jobs.revision_id
      AND files.storage_key = document_scan_jobs.storage_key AND files.byte_size = document_scan_jobs.byte_size
      AND files.media_type = document_scan_jobs.media_type AND files.upload_status = 'finalized'
      AND files.scan_status = 'pending' AND files.cleanup_status = 'none'
      AND revisions.is_current = 1 AND intents.status = 'completed'
)`;
var RECONCILE_INSERT = `INSERT OR IGNORE INTO document_scan_jobs
    (id,file_id,revision_id,storage_key,byte_size,media_type,available_at,created_at,updated_at)
    SELECT lower(hex(randomblob(16))), files.id, files.revision_id, files.storage_key, files.byte_size, files.media_type,
      strftime('%Y-%m-%dT%H:%M:%fZ', ?), ?, ?
    FROM document_revision_files AS files
    JOIN document_revisions AS revisions ON revisions.id=files.revision_id
    JOIN upload_intents AS intents ON intents.revision_file_id=files.id AND intents.status='completed'
    WHERE files.upload_status='finalized' AND files.scan_status='pending'
      AND files.cleanup_status='none' AND revisions.is_current=1
      AND NOT EXISTS (SELECT 1 FROM document_scan_jobs WHERE file_id=files.id)`;
var NON_RETRYABLE_FAILURE_CODES = /* @__PURE__ */ new Set(["unsupported_content", "policy_blocked"]);
/** @param {D1Database} database Binding. @param {string} now UTC time. @returns {Promise<void>} Repairs queue state without assigning clean. */
async function reconcile(database, now) {
	await database.batch([
		database.prepare(RECONCILE_INSERT).bind(now, now, now),
		database.prepare(`UPDATE document_scan_jobs SET available_at=?
            WHERE status='queued' AND available_at > ? AND ${CURRENT_JOB}`).bind(now, now),
		database.prepare(`UPDATE document_scan_jobs SET status='stale',updated_at=?
            WHERE status IN ('queued','leased') AND NOT ${CURRENT_JOB}`).bind(now),
		database.prepare(`UPDATE document_scan_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
            result_code='lease_expired',available_at=?,updated_at=?,lease_token_hash=NULL
            WHERE status='leased' AND lease_until<=?`).bind(now, now, now),
		database.prepare(`UPDATE document_revision_files SET scan_status='failed'
            WHERE scan_status='pending' AND id IN (SELECT file_id FROM document_scan_jobs WHERE status='failed')`)
	]);
}
/** @param {D1Database} database Binding. @param {object} input Runner identity and time. @returns {Promise<object|null>} Atomically leased job. */
async function claim$2(database, input) {
	const leaseUntil = new Date(new Date(input.now).valueOf() + 3e5).toISOString();
	return database.prepare(`UPDATE document_scan_jobs SET status='leased',attempts=attempts+1,
        runner_id=?,lease_token_hash=?,lease_until=?,updated_at=?,object_etag=NULL,content_sha256=NULL
        WHERE id=(SELECT id FROM document_scan_jobs WHERE status='queued' AND available_at<=?
            AND attempts<3 AND ${CURRENT_JOB} ORDER BY available_at,id LIMIT 1)
          AND status='queued' RETURNING *
    `).bind(input.runnerId, input.tokenHash, leaseUntil, input.now, input.now).first();
}
/** @param {D1Database} database Binding. @param {object} input Staff authority and job. @returns {Promise<boolean>} Audited retry. */
async function retry(database, input) {
	return (await database.batch([
		database.prepare(`UPDATE document_scan_jobs SET status='queued',attempts=0,available_at=?,updated_at=?,
            lease_token_hash=NULL,content_sha256=NULL,object_etag=NULL,outcome=NULL,result_code='operator_retry'
            WHERE id=? AND status='failed' AND result_code NOT IN ('unsupported_content','policy_blocked') AND EXISTS (
                SELECT 1 FROM document_revision_files AS files JOIN document_revisions AS revisions ON revisions.id=files.revision_id
                WHERE files.id=document_scan_jobs.file_id AND files.scan_status='failed'
                  AND files.upload_status='finalized' AND files.cleanup_status='none' AND revisions.is_current=1)`).bind(input.now, input.now, input.jobId),
		database.prepare(`UPDATE document_revision_files SET scan_status='pending'
            WHERE id=(SELECT file_id FROM document_scan_jobs WHERE id=? AND status='queued') AND changes()=1`).bind(input.jobId),
		database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'scanner.retry_requested','staff',?,?,'{"result":"requeued"}',? WHERE changes()=1`).bind(crypto.randomUUID(), input.staffId, input.requestId, input.now)
	]))[0].meta.changes === 1;
}
async function prioritizePendingDocument(database, input) {
	return (await database.batch([database.prepare(`UPDATE document_scan_jobs SET available_at=?,updated_at=?,result_code='staff_scan_requested'
            WHERE file_id=(SELECT files.id FROM applications
                JOIN document_records AS records ON records.application_id=applications.id
                JOIN document_requirements AS requirements ON requirements.id=records.requirement_id
                JOIN document_revisions AS revisions ON revisions.document_record_id=records.id AND revisions.is_current=1
                JOIN document_revision_files AS files ON files.revision_id=revisions.id AND files.page_order=0
                JOIN upload_intents AS intents ON intents.revision_file_id=files.id AND intents.status='completed'
                WHERE applications.id=? AND requirements.code=? AND applications.status<>'draft'
                  AND revisions.status='submitted' AND files.upload_status='finalized'
                  AND files.scan_status='pending' AND files.cleanup_status='none' LIMIT 1)
              AND status='queued'`).bind(input.now, input.now, input.applicationId, input.code), database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,document_record_id,
            request_id,safe_metadata_json,created_at)
            SELECT ?, 'scanner.manual_scan_requested','staff',?,records.id,?,'{}',?
            FROM document_scan_jobs AS jobs
            JOIN document_revisions AS revisions ON revisions.id=jobs.revision_id
            JOIN document_records AS records ON records.id=revisions.document_record_id
            WHERE jobs.file_id=(SELECT files.id FROM applications
                JOIN document_records AS matching_records ON matching_records.application_id=applications.id
                JOIN document_requirements AS requirements ON requirements.id=matching_records.requirement_id
                JOIN document_revisions AS current_revisions ON current_revisions.document_record_id=matching_records.id AND current_revisions.is_current=1
                JOIN document_revision_files AS files ON files.revision_id=current_revisions.id AND files.page_order=0
                WHERE applications.id=? AND requirements.code=? LIMIT 1)
              AND changes()=1`).bind(crypto.randomUUID(), input.staffId, input.requestId, input.now, input.applicationId, input.code)]))[0]?.meta?.changes === 1;
}
/** @param {D1Database} database Binding. @param {object} input Exact leased job evidence. @returns {Promise<boolean>} Durable result CAS. */
async function persistResult(database, input) {
	const { job, result, now, tokenHash } = input;
	const isRetry = result.outcome === "failed" && job.attempts < 3 && !NON_RETRYABLE_FAILURE_CODES.has(result.result_code);
	const availableAt = new Date(new Date(now).valueOf() + job.attempts * 6e4).toISOString();
	return (await database.batch([
		database.prepare(`UPDATE document_scan_jobs SET status=?,outcome=?,result_code=?,engine_version=?,signature_version=?,
            signature_updated_at=?,scanned_at=?,updated_at=?,available_at=?
            WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>?
              AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND object_etag IS ? AND content_sha256 IS ? AND ${CURRENT_JOB}`).bind(isRetry ? "queued" : result.outcome === "failed" ? "failed" : "complete", result.outcome, result.result_code, result.engine_version, result.signature_version, result.signature_updated_at, result.scanned_at, now, availableAt, job.id, tokenHash, now, job.object_etag, job.content_sha256),
		database.prepare(`UPDATE document_revision_files SET scan_status=? WHERE id=? AND revision_id=? AND scan_status='pending'
            AND changes()=1`).bind(isRetry ? "pending" : result.outcome, job.file_id, job.revision_id),
		database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,document_record_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'scanner.result_recorded','system',document_record_id,?,?,? FROM document_revisions
            WHERE id=? AND changes()=1`).bind(crypto.randomUUID(), `scanner_${crypto.randomUUID()}`, JSON.stringify({
			outcome: result.outcome,
			resultCode: result.result_code,
			attempt: job.attempts
		}), now, job.revision_id)
	]))[0].meta.changes === 1;
}
/** @param {D1Database} database Binding. @param {object} input Current job and digest. @returns {Promise<boolean>} Whether content was pinned. */
async function bindContent(database, { job, tokenHash, now, etag, sha256 }) {
	return (await database.prepare(`UPDATE document_scan_jobs SET object_etag=?,content_sha256=?
        WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>? AND ${CURRENT_JOB}
          AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (object_etag IS NULL OR object_etag=?)
          AND (content_sha256 IS NULL OR content_sha256=?)`).bind(etag, sha256, job.id, tokenHash, now, etag, sha256).run()).meta.changes === 1;
}
/** @param {D1Database} database Binding. @param {object} input Bounded engine metadata. @returns {Promise<void>} Persisted health. */
async function recordHeartbeat(database, input) {
	await database.prepare(`INSERT INTO scanner_heartbeats(runner_id,health,engine_version,signature_version,signature_updated_at,seen_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(runner_id) DO UPDATE SET health=excluded.health,engine_version=excluded.engine_version,
        signature_version=excluded.signature_version,signature_updated_at=excluded.signature_updated_at,seen_at=excluded.seen_at`).bind(input.runner_id, input.health, input.engine_version, input.signature_version, input.signature_updated_at, input.now).run();
}
/** @param {D1Database} database Binding. @returns {Promise<object>} Counts and safe health metadata. */
async function readStatus(database) {
	const [counts, runners, latest, failures] = await Promise.all([
		database.prepare("SELECT status,count(*) AS count FROM document_scan_jobs GROUP BY status").all(),
		database.prepare("SELECT * FROM scanner_heartbeats ORDER BY seen_at DESC LIMIT 10").all(),
		database.prepare("SELECT max(scanned_at) AS last_successful_scan FROM document_scan_jobs WHERE outcome='clean'").first(),
		database.prepare("SELECT id,attempts,result_code,updated_at FROM document_scan_jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 20").all()
	]);
	return {
		jobs: counts.results,
		runners: runners.results,
		...latest,
		failed_jobs: failures.results
	};
}
/** Creates durable scanner operations. @param {D1Database} database D1 binding. @returns {object} Scanner repository. */
function createScannerRepository(database) {
	return Object.freeze({
		reconcile: (now) => reconcile(database, now),
		claim: (input) => claim$2(database, input),
		retry: (input) => retry(database, input),
		prioritizePendingDocument: (input) => prioritizePendingDocument(database, input),
		persistResult: (input) => persistResult(database, input),
		findLease: ({ jobId, tokenHash, now }) => database.prepare(`SELECT * FROM document_scan_jobs
            WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>? AND ${CURRENT_JOB}`).bind(jobId, tokenHash, now).first(),
		bindContent: (input) => bindContent(database, input),
		heartbeat: (input) => recordHeartbeat(database, input),
		readStatus: () => readStatus(database)
	});
}
//#endregion
//#region src/server/routes/scanner-routes.js
/** @returns {ApiError} A safe lease conflict. */
function createLeaseConflict() {
	return new ApiError(409, "SCAN_LEASE_INVALID", "Tarama işi veya sahiplenme süresi değişti.");
}
/** @param {Request} request Machine request. @param {object} environment Bindings. @returns {Promise<void>} Validated authority. @throws {ApiError} Invalid authentication. */
async function requireScanner(request, environment) {
	const expectedSecret = environment.SCANNER_SECRET;
	if (typeof expectedSecret !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(expectedSecret)) throw new ApiError(503, "SCANNER_UNAVAILABLE", "Tarama hizmeti yapılandırılmamış.");
	if (new URL(request.url).protocol !== "https:") throw new ApiError(403, "HTTPS_REQUIRED", "Güvenli bağlantı gerekli.");
	const providedSecret = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
	const [expectedHash, providedHash] = await Promise.all([hashScannerValue(expectedSecret), hashScannerValue(providedSecret.slice(0, 256))]);
	let difference = 0;
	for (let index = 0; index < expectedHash.length; index += 1) difference |= expectedHash.charCodeAt(index) ^ providedHash.charCodeAt(index);
	if (difference !== 0 || providedSecret.length > 256) throw new ApiError(401, "UNAUTHORIZED", "Tarama yetkisi gerekli.");
	if (!environment.DB || !environment.DOCUMENTS) throw new ApiError(503, "SCANNER_UNAVAILABLE", "Tarama hizmeti kullanılamıyor.");
}
/** @param {Request} request Claim request. @param {object} repository Scanner operations. @param {string} now UTC time. @returns {Promise<object>} One leased job or null. */
async function claim$1(request, repository, now) {
	requireMethod(request, "POST");
	const body = await readJsonBody(request, 1024);
	if (Object.keys(body).length !== 1) throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
	const runnerId = requireScannerIdentifier(body.runner_id);
	await repository.reconcile(now);
	const token = [...crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	const job = await repository.claim({
		now,
		runnerId,
		tokenHash: await hashScannerValue(token)
	});
	if (!job) return { job: null };
	return { job: {
		id: job.id,
		file_id: job.file_id,
		revision_id: job.revision_id,
		storage_key: job.storage_key,
		byte_size: job.byte_size,
		media_type: job.media_type,
		lease_until: job.lease_until,
		lease_token: token
	} };
}
/** @param {object} input Job, request and repository context. @returns {Promise<object>} Current job and token digest. @throws {ApiError} Stale authority. */
async function readLease$1({ request, repository, jobId, now }) {
	const tokenHash = await hashScannerValue(request.headers.get("X-Scan-Lease") || "");
	const job = await repository.findLease({
		jobId,
		tokenHash,
		now
	});
	if (!job) throw createLeaseConflict();
	return {
		job,
		tokenHash
	};
}
/** @param {object|null} object Private object metadata. @param {object} job Expected identity. @returns {boolean} Exact metadata match. */
function isExpectedObject(object, job) {
	return object && object.size === job.byte_size && typeof object.etag === "string" && object.etag.length <= 128 && object.httpMetadata?.contentType === job.media_type;
}
/** @param {object} input Authenticated job context. @returns {Promise<Response>} One bounded object. @throws {ApiError} Invalid identity or authority. */
async function readContent$1({ request, environment, repository, jobId, now }) {
	requireMethod(request, "GET");
	const { job, tokenHash } = await readLease$1({
		request,
		repository,
		jobId,
		now
	});
	if (Date.parse(now) > Date.parse(job.updated_at) + 12e4 || job.byte_size > 10485760) throw createLeaseConflict();
	const object = await environment.DOCUMENTS.head(job.storage_key);
	if (!isExpectedObject(object, job)) throw createLeaseConflict();
	const content = await environment.DOCUMENTS.get(job.storage_key, { onlyIf: { etagMatches: object.etag } });
	if (!isExpectedObject(content, job) || content.etag !== object.etag || typeof content.arrayBuffer !== "function") throw createLeaseConflict();
	const bytes = new Uint8Array(await content.arrayBuffer());
	if (bytes.length !== job.byte_size) throw createLeaseConflict();
	const sha256 = await hashScannerValue(bytes);
	if (!await repository.bindContent({
		job,
		tokenHash,
		now: (/* @__PURE__ */ new Date()).toISOString(),
		etag: object.etag,
		sha256
	})) throw createLeaseConflict();
	return new Response(bytes, { headers: {
		"Content-Type": "application/octet-stream",
		"Content-Length": String(bytes.length),
		"X-Content-SHA256": sha256,
		"X-Object-ETag": object.etag,
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff"
	} });
}
/** @param {object} input Authenticated result context. @returns {Promise<object>} Durable acknowledgement. @throws {ApiError} Invalid evidence or expired lease. */
async function recordResult({ request, environment, repository, jobId, now }) {
	requireMethod(request, "POST");
	const { job, tokenHash } = await readLease$1({
		request,
		repository,
		jobId,
		now
	});
	const result = validateScannerResult({
		result: await readJsonBody(request, 4096),
		job,
		now
	});
	if (result.outcome !== "failed") {
		const object = await environment.DOCUMENTS.head(job.storage_key);
		if (!isExpectedObject(object, job) || object.etag !== job.object_etag) throw createLeaseConflict();
	}
	if (!await repository.persistResult({
		job,
		result,
		tokenHash,
		now: (/* @__PURE__ */ new Date()).toISOString()
	})) throw createLeaseConflict();
	return { recorded: true };
}
/** @param {Request} request Heartbeat. @param {object} repository Operations. @param {string} now UTC time. @returns {Promise<object>} Safe acknowledgement. */
async function heartbeat$1(request, repository, now) {
	requireMethod(request, "POST");
	const body = await readJsonBody(request, 1024);
	if (Object.keys(body).sort().join(",") !== "engine_version,health,runner_id,signature_updated_at,signature_version") throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
	requireScannerIdentifier(body.runner_id);
	if (![
		"ready",
		"engine_unavailable",
		"signature_stale",
		"update_failed"
	].includes(body.health)) throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
	for (const value of [body.engine_version, body.signature_version]) if (value !== null && !(typeof value === "string" && /^[\w.+-]{1,64}$/.test(value))) throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
	const signatureTime = typeof body.signature_updated_at === "string" && body.signature_updated_at.length <= 32 && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(body.signature_updated_at) ? Date.parse(body.signature_updated_at) : NaN;
	if (body.signature_updated_at !== null && !Number.isFinite(signatureTime)) throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
	if (body.health === "ready" && (!body.engine_version || !body.signature_version || !Number.isFinite(signatureTime) || signatureTime > Date.parse(now) + 3e4 || signatureTime < Date.parse(now) - 864e5)) throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
	await repository.heartbeat({
		...body,
		now
	});
	await repository.reconcile(now);
	return { recorded: true };
}
/** Routes machine-only scanner calls. @param {Request} request HTTPS request. @param {object} environment Bindings. @returns {Promise<object|Response>} Safe result. @throws {ApiError} Invalid authority or evidence. */
async function handleScannerRequest(request, environment) {
	await requireScanner(request, environment);
	const repository = createScannerRepository(environment.DB);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const pathname = new URL(request.url).pathname;
	if (pathname === "/api/scanner/claim") return claim$1(request, repository, now);
	if (pathname === "/api/scanner/heartbeat") return heartbeat$1(request, repository, now);
	if (pathname === "/api/scanner/status") {
		requireMethod(request, "GET");
		await repository.reconcile(now);
		return repository.readStatus();
	}
	const match = pathname.match(/^\/api\/scanner\/jobs\/([a-zA-Z0-9_-]{1,64})\/(content|result)$/);
	if (!match) throw new ApiError(404, "NOT_FOUND", "İstenen kaynak bulunamadı.");
	if (match[2] === "content") return readContent$1({
		request,
		environment,
		repository,
		jobId: match[1],
		now
	});
	return recordResult({
		request,
		environment,
		repository,
		jobId: match[1],
		now
	});
}
/** Reads scanner health or performs an audited retry. @param {Request} request Staff request. @param {object} environment Bindings. @param {string} requestId Correlation. @returns {Promise<object>} Safe status. @throws {ApiError} Invalid staff authority. */
async function handleStaffScannerRequest(request, environment, requestId) {
	const pathname = new URL(request.url).pathname;
	requireMethod(request, pathname === "/api/staff/scanner/status" ? "GET" : "POST");
	if (request.method === "POST") requireSameOrigin(request);
	const staff = await requireStaff(request, environment, ["reviewer", "admin"]);
	const repository = createScannerRepository(environment.DB);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	await repository.reconcile(now);
	if (request.method === "GET") return repository.readStatus();
	const body = await readJsonBody(request, 1024);
	if (Object.keys(body).length !== 1) throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
	const jobId = requireScannerIdentifier(body.job_id);
	if (!await repository.retry({
		jobId,
		now,
		staffId: staff.id,
		requestId
	})) throw createLeaseConflict();
	return { requeued: true };
}
/** Expedites the current pending document through the existing PC ClamAV queue. */
async function prioritizeStaffDocumentScan(request, environment, applicationId, documentCode, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const body = await readJsonBody(request, 1024);
	if (Object.keys(body).length !== 0) throw new ApiError(400, "INVALID_SCANNER_INPUT", "Tarama isteği doğrulanamadı.");
	const staff = await requireStaff(request, environment, ["reviewer", "admin"]);
	const repository = createScannerRepository(environment.DB);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	await repository.reconcile(now);
	if (!await repository.prioritizePendingDocument({
		applicationId,
		code: documentCode,
		now,
		staffId: staff.id,
		requestId
	})) throw createLeaseConflict();
	return { queued: true };
}
//#endregion
//#region src/server/http/apiResponse.js
function createRequestId() {
	return `req_${crypto.randomUUID()}`;
}
/**
* Creates a JSON response with a request correlation header and private cache policy.
* @param {unknown} payload JSON-safe response value.
* @param {number} status HTTP status code.
* @param {string} requestId Correlation ID generated at the Worker boundary.
* @param {HeadersInit} [headers] Additional response headers.
* @returns {Response} JSON response.
*/
function jsonResponse(payload, status, requestId, headers = {}) {
	const responseHeaders = new Headers(headers);
	responseHeaders.set("Content-Type", "application/json; charset=utf-8");
	responseHeaders.set("Cache-Control", "no-store");
	responseHeaders.set("X-Request-Id", requestId);
	const responsePayload = payload && typeof payload === "object" && !Array.isArray(payload) ? {
		...payload,
		requestId
	} : {
		data: payload,
		requestId
	};
	return new Response(JSON.stringify(responsePayload), {
		status,
		headers: responseHeaders
	});
}
/**
* Creates the project's machine-readable, user-safe API error response.
* @param {string} requestId Correlation ID generated at the Worker boundary.
* @param {number} status HTTP status code.
* @param {string} code Stable machine-readable error code.
* @param {string} message Safe user-facing message.
* @param {boolean} [retryable] Whether a later retry may succeed.
* @returns {Response} Structured API error.
*/
function errorResponse(requestId, status, code, message, retryable = false) {
	return jsonResponse({ error: {
		code,
		message,
		retryable
	} }, status, requestId);
}
//#endregion
//#region src/server/http/routeResult.js
var ROUTE_RESULT_MARKER = "__worker_route_result__";
/**
* Marks a JSON response with its status and optional session cookie.
* @param {unknown} body JSON-safe response body.
* @param {object} options Response status and optional Set-Cookie value.
* @returns {object} Worker route result wrapper.
*/
function routeResult(body, { status = 200, cookie } = {}) {
	return {
		[ROUTE_RESULT_MARKER]: true,
		body,
		status,
		cookie
	};
}
/**
* Checks whether a value was marked as a Worker route result.
* @param {unknown} value Candidate route value.
* @returns {boolean} True when the value carries the private route marker.
*/
function isRouteResult(value) {
	return Boolean(value?.[ROUTE_RESULT_MARKER]);
}
//#endregion
//#region src/server/auth/applicationAuth.js
/**
* Requires a current application session and returns its server-owned draft data.
* @param {Request} request Fetch API request.
* @param {object} environment Cloudflare Worker bindings.
* @returns {Promise<object>} Application session joined to its student-facing record.
* @throws {ApiError|RepositoryConfigurationError} When the session is absent or expired.
*/
async function requireApplicationSession(request, environment) {
	if (!environment.DB) throw new RepositoryConfigurationError();
	const sessionToken = readCookie(request, getSessionCookieName("application"));
	if (!sessionToken || !/^[A-Za-z0-9_-]{40,48}$/.test(sessionToken)) throw new ApiError(401, "APPLICATION_SESSION_REQUIRED", "Başvuru oturumu sona erdi. Güvenli erişimi yeniden başlatın.");
	const session = await createD1Repositories(environment.DB).sessions.findApplicationSession(await hashSessionToken(sessionToken), (/* @__PURE__ */ new Date()).toISOString());
	if (!session) throw new ApiError(401, "APPLICATION_SESSION_REQUIRED", "Başvuru oturumu sona erdi. Güvenli erişimi yeniden başlatın.");
	return session;
}
//#endregion
//#region src/server/storage/r2DocumentStorage.js
var STORAGE_KEY_PATTERN = /^quarantine\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createStorageError(message, code) {
	const error = new Error(message);
	error.name = "DocumentStorageError";
	error.code = code;
	return error;
}
function redactSigningText(value, sensitiveValues) {
	if (typeof value !== "string") return "";
	let safeText = value.replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]");
	safeText = safeText.replace(/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s"'<>]+/gi, "$1[REDACTED]");
	for (const sensitiveValue of sensitiveValues) {
		if (typeof sensitiveValue !== "string" || !sensitiveValue) continue;
		for (const candidate of [sensitiveValue, encodeURIComponent(sensitiveValue)]) safeText = safeText.split(candidate).join("[REDACTED]");
	}
	return safeText;
}
/**
* Wraps a signing error with safe internal diagnostics for the Worker log.
* @param {unknown} cause Original signing error.
* @param {string} stage AwsClient, requestConstruction, or sign.
* @param {string[]} sensitiveValues Signing values to remove from diagnostic text.
* @returns {Error} Internal error with redacted signing-stage diagnostics.
*/
function createStorageSigningFailure(cause, stage, sensitiveValues = []) {
	const errorName = typeof cause?.name === "string" ? cause.name : "UnknownError";
	const errorCode = typeof cause?.code === "string" || typeof cause?.code === "number" ? String(cause.code) : "";
	const failure = /* @__PURE__ */ new Error("R2 document capability signing failed.");
	failure.name = errorName;
	if (errorCode) failure.code = redactSigningText(errorCode, sensitiveValues);
	failure.storageSigningDiagnostics = Object.freeze({
		storageSigningStage: stage,
		errorName: redactSigningText(errorName, sensitiveValues),
		errorCode: redactSigningText(errorCode, sensitiveValues),
		errorMessage: redactSigningText(cause?.message, sensitiveValues),
		errorStack: redactSigningText(cause?.stack, sensitiveValues)
	});
	return failure;
}
function assertStorageKey(key) {
	if (typeof key === "string" && STORAGE_KEY_PATTERN.test(key)) return;
	throw createStorageError("Storage key is outside the private quarantine namespace.", "INVALID_STORAGE_KEY");
}
function readExpiry(expiresInSeconds) {
	if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 30 || expiresInSeconds > 300) throw createStorageError("Signed access expiry must be between 30 and 300 seconds.", "INVALID_CAPABILITY_EXPIRY");
	return expiresInSeconds;
}
function readContentType(contentType) {
	if (typeof contentType === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType)) return contentType;
	throw createStorageError("A valid content type is required for an upload capability.", "INVALID_CONTENT_TYPE");
}
function createSigner(configuration) {
	const { accountId, bucketName, accessKeyId, secretAccessKey } = configuration;
	const isValidAccountId = typeof accountId === "string" && /^[0-9a-f]{32}$/i.test(accountId);
	const isValidBucketName = typeof bucketName === "string" && /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucketName);
	if (!isValidAccountId || !isValidBucketName || ![accessKeyId, secretAccessKey].every((value) => typeof value === "string" && value.trim())) throw createStorageError("R2 signing configuration is unavailable.", "STORAGE_SIGNING_CONFIGURATION_ERROR");
	return new AwsClient({
		service: "s3",
		region: "auto",
		accessKeyId,
		secretAccessKey
	});
}
function formatSigningDate(date) {
	return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
function createObjectUrl(accountId, bucketName, key) {
	const url = new URL(`https://${accountId}.r2.cloudflarestorage.com`);
	url.pathname = `/${bucketName}/${key}`;
	return url;
}
function createQuarantineKey(createId) {
	const id = createId();
	if (typeof id !== "string" || !/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id)) throw new TypeError("Storage key generator must return a UUID.");
	return `quarantine/${id}`;
}
function createObjectOperations(bucket) {
	return {
		async put(key, body, contentType) {
			assertStorageKey(key);
			return bucket.put(key, body, { httpMetadata: { contentType } });
		},
		async get(key, options = {}) {
			assertStorageKey(key);
			return options.etagMatches ? bucket.get(key, { onlyIf: { etagMatches: options.etagMatches } }) : bucket.get(key);
		},
		async head(key) {
			assertStorageKey(key);
			return bucket.head(key);
		},
		async delete(key) {
			assertStorageKey(key);
			return bucket.delete(key);
		}
	};
}
function createCapabilityGenerator(accountId, bucketName, readSigner, now, signingValues) {
	return async (key, options = {}, operation, writeOnce = false) => {
		const { expiresInSeconds = 300, contentType } = options;
		assertStorageKey(key);
		const expiry = readExpiry(expiresInSeconds);
		const signingTime = now();
		if (!(signingTime instanceof Date) || Number.isNaN(signingTime.valueOf())) throw new TypeError("Storage clock must return a valid Date.");
		const putType = operation === "PUT" ? readContentType(contentType) : void 0;
		const conditionalHeader = operation === "PUT" && writeOnce ? { "if-none-match": "*" } : {};
		let stage = "AwsClient";
		let signedRequest;
		try {
			const signer = readSigner();
			stage = "requestConstruction";
			const url = createObjectUrl(accountId, bucketName, key);
			url.searchParams.set("X-Amz-Expires", String(expiry));
			const request = new Request(url, {
				method: operation,
				...putType ? { headers: {
					"content-type": putType,
					...conditionalHeader
				} } : {}
			});
			stage = "sign";
			signedRequest = await signer.sign(request, { aws: {
				signQuery: true,
				allHeaders: true,
				datetime: formatSigningDate(signingTime)
			} });
		} catch (error) {
			throw createStorageSigningFailure(error, stage, signingValues);
		}
		return Object.freeze({
			method: operation,
			url: signedRequest.url,
			expiresAt: new Date(signingTime.valueOf() + expiry * 1e3).toISOString(),
			expiresInSeconds: expiry,
			...putType ? { requiredHeaders: Object.freeze({
				"content-type": putType,
				...conditionalHeader
			}) } : {}
		});
	};
}
/**
* Creates a private R2 adapter with provider-neutral object and capability operations.
* @param {R2Bucket} bucket Private R2 bucket binding available only to the Worker.
* @param {object} [configuration] Server-only signing credentials and deterministic test hooks.
* @returns {object} Private storage operations and short-lived upload/read capabilities.
*/
function createR2DocumentStorage(bucket, configuration = {}) {
	if (!bucket) throw new TypeError("A private R2 bucket binding is required.");
	const { accountId, bucketName, accessKeyId, secretAccessKey } = configuration;
	const createId = configuration.createId || (() => crypto.randomUUID());
	const now = configuration.now || (() => /* @__PURE__ */ new Date());
	let signer;
	const readSigner = () => signer || (signer = createSigner({
		accountId,
		bucketName,
		accessKeyId,
		secretAccessKey
	}));
	const createCapability = createCapabilityGenerator(accountId, bucketName, readSigner, now, [accessKeyId, secretAccessKey]);
	return Object.freeze({
		createQuarantineKey: () => createQuarantineKey(createId),
		...createObjectOperations(bucket),
		createUploadCapability: (key, options = {}) => createCapability(key, options, "PUT"),
		createWriteOnceUploadCapability: (key, options = {}) => createCapability(key, options, "PUT", true),
		createReadCapability: (key, options = {}) => createCapability(key, options, "GET")
	});
}
//#endregion
//#region src/server/storage/documentStorage.js
/**
* Creates the application-facing private document storage adapter.
* @param {object} environment Cloudflare Worker bindings and server-only R2 signing values.
* @returns {object} Provider-neutral document storage operations.
* @throws {RepositoryConfigurationError} When the private R2 binding is unavailable.
*/
function createDocumentStorage(environment) {
	if (!environment?.DOCUMENTS) {
		const error = new RepositoryConfigurationError();
		error.code = "STORAGE_CONFIGURATION_ERROR";
		throw error;
	}
	return createR2DocumentStorage(environment.DOCUMENTS, {
		accountId: environment.R2_ACCOUNT_ID,
		bucketName: environment.R2_BUCKET_NAME,
		accessKeyId: environment.R2_ACCESS_KEY_ID,
		secretAccessKey: environment.R2_SECRET_ACCESS_KEY
	});
}
//#endregion
//#region src/server/domain/studentUploadMetadata.js
/**
* Reduces an untrusted browser filename to a safe display name.
* @param {string} filename Original filename from the request body.
* @returns {string} Sanitized filename suitable for stored metadata.
*/
function sanitizeStudentFilename(filename) {
	return ((filename.split(/[\\/]/).pop() || "document").normalize("NFKC").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[. ]+|[. ]+$/g, "") || "document").slice(0, 120);
}
/**
* Validates student upload metadata against the active centralized policy.
* @param {object} body Parsed untrusted upload request body.
* @param {object} policy Active server-owned document policy.
* @returns {{code: string, filename: string, mediaType: string, byteSize: number}} Safe metadata.
* @throws {ApiError} When the code, filename, media type, or size is invalid.
*/
function readStudentUploadMetadata(body, policy) {
	const code = typeof body?.code === "string" ? body.code.trim() : "";
	const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
	const mediaType = typeof body?.media_type === "string" ? body.media_type.trim().toLowerCase() : "";
	const byteSize = body?.byte_size;
	const acceptedMediaTypes = policy?.accepted_media_types;
	const maxByteSize = policy?.max_byte_size;
	if (!/^[a-z0-9_]{1,80}$/.test(code) || !filename || filename.length > 255 || !Array.isArray(acceptedMediaTypes) || !acceptedMediaTypes.includes(mediaType) || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > maxByteSize) throw new ApiError(400, Number.isSafeInteger(byteSize) && byteSize > maxByteSize ? "FILE_TOO_LARGE" : "INVALID_FILE", "Belge biçimini ve boyutunu kontrol edip tekrar deneyin.");
	return {
		code,
		filename: sanitizeStudentFilename(filename),
		mediaType,
		byteSize
	};
}
//#endregion
//#region src/server/routes/applicationDocumentRoutes.js
var UPLOAD_INTENT_SECONDS = 600;
async function readCurrentStudentRequirements(session, environment) {
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(session.application_id);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	const storedRequirements = await repositories.documents.listStudentRequirements(application.id);
	return {
		application,
		repositories,
		requirements: listDocumentPolicies(application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null).filter((policy) => storedRequirements.some((entry) => entry.code === policy.code)).map((policy) => {
			const stored = storedRequirements.find((entry) => entry.code === policy.code);
			return {
				...policy,
				review_status: stored.review_status,
				revision_number: stored.revision_number,
				revision_status: stored.revision_status,
				upload_status: stored.upload_status,
				scan_status: stored.scan_status,
				original_filename: stored.original_filename,
				cleanup_status: stored.cleanup_status
			};
		})
	};
}
function createStudentRequirementDto(requirement) {
	return {
		code: requirement.code,
		required: requirement.required,
		is_required: requirement.required,
		display_order: requirement.display_order,
		label_key: requirement.label_key,
		description_key: requirement.description_key,
		accepted_media_types: requirement.accepted_media_types,
		max_byte_size: requirement.max_byte_size,
		conditional_rule: requirement.conditional_rule,
		revision_number: requirement.revision_number ?? null,
		review_status: requirement.review_status ?? null,
		revision_status: requirement.revision_status ?? null,
		upload_status: requirement.upload_status ?? null,
		scan_status: requirement.scan_status ?? null,
		filename: requirement.original_filename ?? null,
		cleanup_status: requirement.cleanup_status ?? null
	};
}
function requireDraftApplication(application) {
	if (application.status !== "draft") throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Bu başvuru artık düzenlenemez.");
}
function requireOwnedRequirement(requirements, code) {
	const requirement = requirements.find((entry) => entry.code === code);
	if (requirement) return requirement;
	throw new ApiError(404, "DOCUMENT_REQUIREMENT_NOT_FOUND", "Bu başvuru için belge gereksinimi bulunamadı.");
}
function createUploadResponse(intentId, capability, expiresAt) {
	return { upload: {
		intent_id: intentId,
		method: capability.method,
		url: capability.url,
		required_headers: capability.requiredHeaders,
		capability_expires_at: capability.expiresAt,
		intent_expires_at: expiresAt
	} };
}
/**
* Reads the server-calculated residence-document set for the current application owner.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Student-safe requirements without internal identifiers or storage keys.
* @throws {ApiError} When the owner session or application is unavailable.
*/
async function readCurrentStudentDocumentRequirements(request, environment) {
	requireMethod(request, "GET");
	const { application, requirements } = await readCurrentStudentRequirements(await requireApplicationSession(request, environment), environment);
	return {
		application: {
			application_type: application.application_type,
			address_evidence_type: application.address_evidence_type ?? null,
			is_under_18: application.is_under_18 === 1
		},
		requirements: requirements.map(createStudentRequirementDto)
	};
}
/**
* Creates an owner-bound revision and a short-lived direct-to-R2 upload capability.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Upload capability and opaque intent reference.
* @throws {ApiError} When ownership, requirement, file metadata, or storage configuration is invalid.
*/
async function createCurrentStudentDocumentUploadIntent(request, environment) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const { application, repositories, requirements } = await readCurrentStudentRequirements(await requireApplicationSession(request, environment), environment);
	const body = await readJsonBody(request);
	const requestedCode = typeof body.code === "string" ? body.code.trim() : "";
	requireOwnedRequirement(requirements, requestedCode);
	const policy = readDocumentPolicy(requestedCode, application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null);
	const metadata = readStudentUploadMetadata(body, policy);
	requireDraftApplication(application);
	requireOwnedRequirement(requirements, metadata.code);
	const requirement = await repositories.documents.findStudentRequirementId(application.application_type, metadata.code);
	if (!requirement) throw new ApiError(404, "DOCUMENT_REQUIREMENT_NOT_FOUND", "Bu başvuru için belge gereksinimi bulunamadı.");
	const now = /* @__PURE__ */ new Date();
	const expiresAt = new Date(now.valueOf() + UPLOAD_INTENT_SECONDS * 1e3).toISOString();
	const storage = createDocumentStorage(environment);
	const storageKey = storage.createQuarantineKey();
	const intentId = crypto.randomUUID();
	let capability;
	try {
		capability = await storage.createWriteOnceUploadCapability(storageKey, {
			contentType: metadata.mediaType,
			expiresInSeconds: 300
		});
	} catch (error) {
		const diagnostics = error?.storageSigningDiagnostics;
		const logFields = {
			storageSigningStage: diagnostics?.storageSigningStage || "unknown",
			errorName: diagnostics?.errorName || error?.name || "UnknownError",
			errorCode: diagnostics?.errorCode || error?.code || "STORAGE_SIGNING_ERROR"
		};
		if (environment.APP_ENV === "staging" && diagnostics) {
			logFields.errorMessage = diagnostics.errorMessage;
			logFields.errorStack = diagnostics.errorStack;
		}
		console.error("Student document upload capability failed.", { ...logFields });
		throw new ApiError(503, "STORAGE_UNAVAILABLE", "Belge yükleme hizmeti şu anda kullanılamıyor.", true);
	}
	if (!await repositories.documents.createStudentUploadIntent({
		applicationId: application.id,
		requirementId: requirement.id,
		conditionalRule: policy.conditional_rule,
		documentRecordId: crypto.randomUUID(),
		revisionId: crypto.randomUUID(),
		fileId: crypto.randomUUID(),
		storageKey,
		filename: metadata.filename,
		mediaType: metadata.mediaType,
		byteSize: metadata.byteSize,
		intentId,
		idempotencyKey: crypto.randomUUID(),
		expiresAt,
		createdAt: now.toISOString()
	})) throw new ApiError(409, "DOCUMENT_REQUIREMENT_CHANGED", "Belge gereksinimi değişti. Listeyi yenileyip tekrar deneyin.");
	return routeResult(createUploadResponse(intentId, capability, expiresAt), { status: 201 });
}
function isEligibleRequirement(requirements, code) {
	return requirements.some((requirement) => requirement.code === code);
}
function createFinalizedDocumentDto(intent) {
	return {
		code: intent.code,
		revision_number: intent.revision_number,
		upload_status: "finalized",
		scan_status: "pending"
	};
}
/**
* Verifies the uploaded R2 object, then makes its revision the current student document.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Student-safe finalized document state.
* @throws {ApiError} When the upload intent, object, owner session, or current requirement is invalid.
*/
async function finalizeCurrentStudentDocument(request, environment) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const session = await requireApplicationSession(request, environment);
	const body = await readJsonBody(request);
	if (typeof body.intent_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.intent_id)) throw new ApiError(400, "VALIDATION_ERROR", "Belge yüklemesini doğrulayıp tekrar deneyin.");
	const { application, repositories, requirements } = await readCurrentStudentRequirements(session, environment);
	requireDraftApplication(application);
	const intent = await repositories.documents.findStudentUploadIntent(application.id, body.intent_id);
	if (!intent || !isEligibleRequirement(requirements, intent.code)) throw new ApiError(404, "DOCUMENT_REQUIREMENT_NOT_FOUND", "Belge yüklemesi bu başvuru için bulunamadı.");
	if (intent.intent_status === "completed") return { document: createFinalizedDocumentDto(intent) };
	if (intent.intent_status !== "pending") throw new ApiError(409, "UPLOAD_INTENT_UNAVAILABLE", "Belge yükleme bağlantısı artık kullanılamıyor.");
	if (new Date(intent.expires_at).valueOf() <= Date.now()) {
		await repositories.documents.expireStudentUploadIntent(application.id, intent.id);
		throw new ApiError(409, "UPLOAD_INTENT_EXPIRED", "Belge yükleme süresi doldu. Yeni bir yükleme başlatın.");
	}
	const storage = createDocumentStorage(environment);
	const object = await storage.head(intent.storage_key);
	if (!object) throw new ApiError(409, "UPLOAD_OBJECT_MISSING", "Yüklenen belge bulunamadı. Yüklemeyi yeniden deneyin.");
	const actualSize = object.size;
	const actualMediaType = object.httpMetadata?.contentType;
	const policy = readDocumentPolicy(intent.code, application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null);
	if (!policy || actualSize !== intent.byte_size || actualSize > policy.max_byte_size || !policy.accepted_media_types.includes(actualMediaType) || actualMediaType !== intent.media_type) {
		await repositories.documents.rejectStudentUpload(application.id, intent.id);
		await storage.delete(intent.storage_key);
		throw new ApiError(409, "UPLOAD_OBJECT_MISMATCH", "Yüklenen belge bilgileri doğrulanamadı. Yeni bir yükleme başlatın.");
	}
	const finalizedAt = (/* @__PURE__ */ new Date()).toISOString();
	if (!await repositories.documents.finalizeStudentUpload({
		applicationId: application.id,
		intentId: intent.id,
		fileId: intent.file_id,
		revisionId: intent.revision_id,
		documentRecordId: intent.document_record_id,
		conditionalRule: policy.conditional_rule,
		finalizedAt
	})) {
		const refreshedIntent = await repositories.documents.findStudentUploadIntent(application.id, intent.id);
		if (refreshedIntent?.intent_status !== "completed") throw new ApiError(409, "UPLOAD_INTENT_UNAVAILABLE", "Belge yükleme bağlantısı artık kullanılamıyor.");
		return { document: createFinalizedDocumentDto(refreshedIntent) };
	}
	return { document: createFinalizedDocumentDto(intent) };
}
/**
* Removes the current student's draft document from visibility, then retries private R2 cleanup safely.
* @param {Request} request Owner-session DELETE request.
* @param {object} environment Worker bindings.
* @param {string} code Student-safe policy code from the route.
* @returns {Promise<object>} Cleanup state without exposing file identifiers or storage keys.
* @throws {ApiError} When the session, origin, application state, or requirement is invalid.
*/
async function deleteCurrentStudentDocument(request, environment, code) {
	requireMethod(request, "DELETE");
	requireSameOrigin(request);
	const { application, repositories, requirements } = await readCurrentStudentRequirements(await requireApplicationSession(request, environment), environment);
	requireDraftApplication(application);
	requireOwnedRequirement(requirements, code);
	const deletion = await repositories.documents.beginStudentDocumentDelete({
		applicationId: application.id,
		code,
		requestedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
	if (!deletion.found) return { cleanup_status: "complete" };
	if (deletion.locked) throw new ApiError(409, "DOCUMENT_NOT_EDITABLE", "Bu belge artık öğrenci tarafından değiştirilemez.");
	const storage = createDocumentStorage(environment);
	const files = await repositories.documents.listStudentDocumentCleanupFiles(application.id, code);
	for (const file of files) try {
		await storage.delete(file.storage_key);
		await repositories.documents.completeStudentDocumentCleanup(application.id, code, file.id);
	} catch (error) {
		console.error("Student document cleanup remains pending.", {
			errorName: error?.name || "UnknownError",
			errorCode: error?.code || "STORAGE_DELETE_ERROR"
		});
	}
	return { cleanup_status: (await repositories.documents.listStudentDocumentCleanupFiles(application.id, code)).length ? "pending" : "complete" };
}
//#endregion
//#region src/server/security/application-rate-limits.js
/** Campus pilot assumes up to 120 students creating drafts through one NAT in 15 minutes. */
var APPLICATION_CREATE_RATE_LIMIT = Object.freeze({
	endpoint: "application-create",
	maxRequests: 120,
	windowSeconds: 900
});
/** Public status remains manual: 120 students can perform two lookups each, with 60 slots of margin. */
var APPLICATION_TRACKING_RATE_LIMIT = Object.freeze({
	endpoint: "application-tracking-lookup",
	maxRequests: 300,
	windowSeconds: 900
});
//#endregion
//#region src/shared/phoneNumber.js
/**
* Validates a phone number with optional international prefix and common visual separators.
* @param {unknown} phoneNumber Contact phone value.
* @returns {boolean} Whether the value contains 7 to 15 digits and no unsupported characters.
*/
function isValidPhoneNumber(phoneNumber) {
	if (typeof phoneNumber !== "string") return false;
	const normalizedPhone = phoneNumber.trim();
	if (!/^\+?[\d\s().-]+$/.test(normalizedPhone)) return false;
	const digits = normalizedPhone.replace(/\D/g, "");
	return digits.length >= 7 && digits.length <= 15;
}
//#endregion
//#region src/shared/age.js
var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
function readCalendarDate(value) {
	if (typeof value !== "string") return null;
	const match = DATE_PATTERN.exec(value);
	if (!match) return null;
	const [, yearText, monthText, dayText] = match;
	const parts = {
		year: Number(yearText),
		month: Number(monthText),
		day: Number(dayText)
	};
	const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
	return date.getUTCFullYear() === parts.year && date.getUTCMonth() === parts.month - 1 && date.getUTCDate() === parts.day ? parts : null;
}
/**
* Returns the under-18 answer by comparing calendar dates without timezone conversion.
* @param {string|null} dateOfBirth ISO date-only birth date.
* @param {string} currentDate ISO date-only date on which age is measured.
* @returns {boolean|null} True for under 18, false for 18 or older, null for invalid dates.
*/
function calculateUnder18(dateOfBirth, currentDate) {
	const birthDate = readCalendarDate(dateOfBirth);
	const asOfDate = readCalendarDate(currentDate);
	if (!birthDate || !asOfDate) return null;
	const birthKey = `${String(birthDate.year).padStart(4, "0")}-${String(birthDate.month).padStart(2, "0")}-${String(birthDate.day).padStart(2, "0")}`;
	const currentKey = `${String(asOfDate.year).padStart(4, "0")}-${String(asOfDate.month).padStart(2, "0")}-${String(asOfDate.day).padStart(2, "0")}`;
	if (birthKey > currentKey) return null;
	return currentKey < `${String(birthDate.year + 18).padStart(4, "0")}-${String(birthDate.month).padStart(2, "0")}-${String(birthDate.day).padStart(2, "0")}`;
}
/**
* Reads today's calendar date in the institution's Istanbul timezone.
* @param {Date} now Current instant.
* @returns {string} ISO date-only value for Europe/Istanbul.
*/
function readIstanbulDate(now = /* @__PURE__ */ new Date()) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/Istanbul",
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).formatToParts(now);
	const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
	return `${values.year}-${values.month}-${values.day}`;
}
//#endregion
//#region src/server/services/submissionReadiness.js
var APPLICATION_TYPES = /* @__PURE__ */ new Set(["initial", "renewal"]);
var ADDRESS_EVIDENCE_TYPES = /* @__PURE__ */ new Set([
	"rental_contract",
	"residence_certificate",
	"undertaking"
]);
var ACCEPTED_REVISION_STATUSES = /* @__PURE__ */ new Set(["submitted", "approved"]);
var ACCEPTED_SCAN_STATUSES = /* @__PURE__ */ new Set(["pending", "clean"]);
var REQUIRED_FIELDS = Object.freeze([
	"student_number",
	"application_type",
	"student_email",
	"student_phone",
	"first_name",
	"last_name",
	"passport_number",
	"nationality",
	"date_of_birth",
	"is_under_18",
	"address_evidence_type"
]);
function isPresentText(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function isValidDate(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value && parsed.valueOf() <= Date.now();
}
function isTrue(value) {
	return value === true || value === 1;
}
function isValidCoreField(field, application) {
	const value = application[field];
	if (field === "application_type") return APPLICATION_TYPES.has(value);
	if (field === "student_email") return isPresentText(value) && value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
	if (field === "student_phone") return isValidPhoneNumber(value) && value.trim().length <= 40;
	if (field === "date_of_birth") return isValidDate(value);
	if (field === "is_under_18") return value === 0 || value === 1 || typeof value === "boolean";
	if (field === "address_evidence_type") return ADDRESS_EVIDENCE_TYPES.has(value);
	return isPresentText(value) && value.trim().length <= 255;
}
function isCurrentFinalizedDocument(document) {
	return (document.has_current_revision === true || document.has_current_revision === 1) && ACCEPTED_REVISION_STATUSES.has(document.revision_status) && document.upload_status === "finalized" && ACCEPTED_SCAN_STATUSES.has(document.scan_status) && (document.cleanup_status === null || document.cleanup_status === "none") && document.upload_intent_status === "completed";
}
function uniqueSorted(values) {
	return [...new Set(values)].sort();
}
function readMissingFields(application, declarationVersion) {
	const missingFields = REQUIRED_FIELDS.filter((field) => !isValidCoreField(field, application));
	if (!isPresentText(application.student_number) || application.student_number.length > 64) missingFields.push("student_number");
	if (application.fingerprint_status !== "registered" || !isPresentText(application.fingerprint_code) || application.fingerprint_code.trim().length > 128 || /[\u0000-\u001f\u007f]/u.test(application.fingerprint_code)) missingFields.push("fingerprint_status");
	if (!isTrue(application.contact_acknowledgement_accepted_current)) missingFields.push("contact_acknowledgement");
	if (!application.declaration_accepted_at || application.declaration_version !== declarationVersion) missingFields.push("declaration");
	return uniqueSorted(missingFields);
}
function readMissingDocuments(policies, documents) {
	const documentByCode = new Map(documents.map((document) => [document.code, document]));
	return uniqueSorted(policies.filter((policy) => policy.required).filter((policy) => {
		const document = documentByCode.get(policy.code);
		return !document || !isTrue(document.has_active_requirement) || !isTrue(document.is_required) || !isCurrentFinalizedDocument(document);
	}).map((policy) => policy.code));
}
function readReasonCodes(application, missingFields, missingDocuments, declarationVersion) {
	const reasonCodes = [];
	if (!application.id) reasonCodes.push("APPLICATION_NOT_FOUND");
	if (application.status !== "draft") reasonCodes.push("APPLICATION_NOT_DRAFT");
	if (!isTrue(application.contact_acknowledgement_accepted_current)) reasonCodes.push("CONTACT_ACKNOWLEDGEMENT_REQUIRED");
	if (!application.declaration_accepted_at || application.declaration_version !== declarationVersion) reasonCodes.push("DECLARATION_REQUIRED");
	if (missingFields.some((field) => !["contact_acknowledgement", "declaration"].includes(field))) reasonCodes.push("APPLICATION_FIELDS_INCOMPLETE");
	if (missingDocuments.length > 0) reasonCodes.push("REQUIRED_DOCUMENTS_INCOMPLETE");
	return uniqueSorted(reasonCodes);
}
/**
* Evaluates the persisted application snapshot against the current server-owned document policy.
* @param {object} application Persisted application and current acknowledgement state.
* @param {Array<object>} policies Applicable document policies from `documentPolicy.js`.
* @param {Array<object>} documents D1 states for active requirement codes.
* @param {{declarationVersion: string}} versions Current configured declaration version; contact acknowledgement is resolved by the D1 audit repository.
* @returns {{status: 'ready'|'not_ready', reason_codes: string[], missing_fields: string[], missing_documents: string[]}} Stable readiness result without internal identifiers.
*/
function evaluateSubmissionReadiness(application, policies, documents, versions) {
	const persistedApplication = application || {};
	const missingFields = readMissingFields(persistedApplication, versions.declarationVersion);
	const missingDocuments = readMissingDocuments(policies, documents);
	const stableReasons = readReasonCodes(persistedApplication, missingFields, missingDocuments, versions.declarationVersion);
	return Object.freeze({
		status: stableReasons.length === 0 ? "ready" : "not_ready",
		reason_codes: stableReasons,
		missing_fields: missingFields,
		missing_documents: missingDocuments
	});
}
/**
* Loads current D1 application and document state before evaluating submission readiness.
* @param {string} applicationId Application selected only from the authenticated session.
* @param {object} environment Worker bindings containing D1.
* @param {string} declarationVersion Validated configured declaration version.
* @returns {Promise<object>} Deterministic readiness result.
*/
async function readSubmissionReadiness(applicationId, environment, declarationVersion) {
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(applicationId);
	if (!application) return Object.freeze({
		status: "not_ready",
		reason_codes: ["APPLICATION_NOT_FOUND"],
		missing_fields: [],
		missing_documents: []
	});
	return evaluateSubmissionReadiness(application, listDocumentPolicies(application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null), await repositories.documents.listSubmissionRequirementStates(applicationId), { declarationVersion });
}
//#endregion
//#region src/server/routes/applicationRoutes.js
var APPLICATION_SESSION_SECONDS = 15552e3;
var APPLICATION_TYPE_VALUES = /* @__PURE__ */ new Set(["initial", "renewal"]);
var ADDRESS_EVIDENCE_VALUES = /* @__PURE__ */ new Set([
	"rental_contract",
	"residence_certificate",
	"undertaking"
]);
var DRAFT_FIELDS = Object.freeze({
	first_name: "firstName",
	last_name: "lastName",
	passport_number: "passportNumber",
	nationality: "nationality",
	date_of_birth: "dateOfBirth",
	student_email: "studentEmail",
	student_phone: "studentPhone"
});
function requireString(body, name, { min = 1, max = 255 } = {}) {
	const value = body[name];
	if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new ApiError(400, "VALIDATION_ERROR", "Başvuru bilgilerini kontrol edip tekrar deneyin.");
	return value.trim();
}
function readDeclarationVersion(environment) {
	const version = environment.PUBLIC_DECLARATION_VERSION || "student-information-accuracy-v1";
	if (typeof version === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(version)) return version;
	throw new ApiError(503, "DECLARATION_CONFIGURATION_UNAVAILABLE", "Başvuru onay bilgisi şu anda kullanılamıyor.", true);
}
function createApplicationDto(application, environment) {
	const currentDeclarationVersion = readDeclarationVersion(environment);
	return {
		reference_number: application.reference_number ?? null,
		lock_version: application.lock_version ?? 1,
		status: application.status,
		submitted_at: application.submitted_at ?? null,
		application_type: application.application_type,
		address_evidence_type: application.address_evidence_type ?? null,
		student_number: application.student_number,
		student_email: application.student_email,
		student_phone: application.student_phone,
		first_name: application.first_name,
		last_name: application.last_name,
		passport_number: application.passport_number,
		nationality: application.nationality,
		date_of_birth: application.date_of_birth,
		is_under_18: application.is_under_18,
		fingerprint_status: application.fingerprint_status ?? null,
		fingerprint_code: application.fingerprint_code ?? null,
		contact_acknowledgement: {
			current_version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
			accepted_version: application.contact_acknowledgement_accepted_current ? CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION : null,
			accepted_at: application.contact_acknowledgement_accepted_at ?? null,
			accepted_current: Boolean(application.contact_acknowledgement_accepted_current)
		},
		declaration: {
			current_version: currentDeclarationVersion,
			content_key: "studentInformationAcknowledgement",
			accepted_version: application.declaration_version ?? null,
			accepted_at: application.declaration_accepted_at ?? null,
			accepted_current: Boolean(application.declaration_accepted_at) && application.declaration_version === currentDeclarationVersion
		}
	};
}
function readNewDraft(body) {
	const studentNumber = requireString(body, "student_number", { max: 64 });
	const applicationType = body.application_type;
	if (!APPLICATION_TYPE_VALUES.has(applicationType)) throw new ApiError(400, "VALIDATION_ERROR", "Başvuru türünü kontrol edip tekrar deneyin.");
	const studentEmail = requireString(body, "email", { max: 254 });
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) throw new ApiError(400, "VALIDATION_ERROR", "E-posta adresini kontrol edip tekrar deneyin.");
	return {
		studentNumber,
		applicationType,
		studentEmail,
		studentPhone: requireString(body, "phone", { max: 40 })
	};
}
async function persistDraftWithSession(repositories, draft, requestId) {
	const token = createOpaqueSessionToken();
	const accessCode = generateAccessCode();
	const accessCodeHash = await hashAccessCode(accessCode);
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	try {
		return {
			application: await repositories.applications.createDraftWithSession({
				...draft,
				applicationId: crypto.randomUUID(),
				studentId: crypto.randomUUID(),
				sessionId: crypto.randomUUID(),
				auditEventId: crypto.randomUUID(),
				requestId,
				accessCodeHash,
				tokenHash: await hashSessionToken(token),
				expiresAt: new Date(Date.parse(createdAt) + APPLICATION_SESSION_SECONDS * 1e3).toISOString(),
				createdAt
			}),
			token,
			accessCode
		};
	} catch (error) {
		if (error instanceof ApplicationConflictError) throw new ApiError(409, error.code, "Bu öğrenci için zaten etkin bir başvuru bulunuyor.");
		throw error;
	}
}
function readFingerprintStatus(value) {
	if (value === null) return null;
	if (value === "registered" || value === "not_registered") return value;
	throw new ApiError(400, "VALIDATION_ERROR", "Başvuru bilgilerini kontrol edip tekrar deneyin.");
}
function readFingerprintCode(value) {
	if (value === null) return null;
	if (typeof value !== "string") throw new ApiError(400, "VALIDATION_ERROR", "Başvuru bilgilerini kontrol edip tekrar deneyin.");
	const code = value.trim();
	if (code.length > 128 || /[\u0000-\u001f\u007f]/u.test(code)) throw new ApiError(400, "VALIDATION_ERROR", "Başvuru bilgilerini kontrol edip tekrar deneyin.");
	return code || null;
}
function readDraftChanges(body, application, { allowIncomplete = false } = {}) {
	const changes = {};
	for (const [field, repositoryField] of Object.entries(DRAFT_FIELDS)) if (Object.hasOwn(body, field)) changes[repositoryField] = requireString(body, field, {
		min: allowIncomplete ? 0 : 1,
		max: field === "student_email" ? 254 : 255
	});
	if (Object.hasOwn(body, "application_type")) {
		if (!APPLICATION_TYPE_VALUES.has(body.application_type)) throw new ApiError(400, "VALIDATION_ERROR", "Başvuru türünü kontrol edip tekrar deneyin.");
		changes.applicationType = body.application_type;
	}
	if (Object.hasOwn(body, "address_evidence_type")) {
		if (body.address_evidence_type !== null && !ADDRESS_EVIDENCE_VALUES.has(body.address_evidence_type)) throw new ApiError(400, "VALIDATION_ERROR", "Adres belgesi seçimini kontrol edip tekrar deneyin.");
		changes.addressEvidenceType = body.address_evidence_type;
	}
	if (Object.hasOwn(body, "is_under_18")) {
		if (body.is_under_18 !== null && typeof body.is_under_18 !== "boolean") throw new ApiError(400, "VALIDATION_ERROR", "Başvuru bilgilerini kontrol edip tekrar deneyin.");
		changes.isUnder18 = body.is_under_18 === null ? null : body.is_under_18 ? 1 : 0;
	}
	if (Object.hasOwn(body, "date_of_birth") || Object.hasOwn(body, "is_under_18")) {
		const under18 = calculateUnder18(changes.dateOfBirth ?? application.date_of_birth, readIstanbulDate());
		if (under18 === null && !allowIncomplete) throw new ApiError(400, "VALIDATION_ERROR", "Doğum tarihini kontrol edip tekrar deneyin.");
		changes.isUnder18 = under18 === null ? null : under18 ? 1 : 0;
	}
	const fingerprintStatus = Object.hasOwn(body, "fingerprint_status") ? readFingerprintStatus(body.fingerprint_status) : application.fingerprint_status;
	if (Object.hasOwn(body, "fingerprint_status")) changes.fingerprintStatus = fingerprintStatus;
	if (Object.hasOwn(body, "fingerprint_code")) {
		const submittedCode = readFingerprintCode(body.fingerprint_code);
		changes.fingerprintCode = fingerprintStatus === "registered" ? submittedCode : null;
	}
	if (Object.hasOwn(body, "fingerprint_status") && fingerprintStatus !== "registered") changes.fingerprintCode = null;
	if (!allowIncomplete && Object.hasOwn(changes, "studentEmail") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.studentEmail)) throw new ApiError(400, "VALIDATION_ERROR", "E-posta adresini kontrol edip tekrar deneyin.");
	if (Object.keys(changes).length === 0) throw new ApiError(400, "VALIDATION_ERROR", "Güncellenecek başvuru bilgisi gerekli.");
	return changes;
}
/**
* Creates a rate-limited draft and binds it to a hashed opaque applicant session.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation ID for the audit event.
* @returns {Promise<object>} Route result with a student-safe DTO and session cookie.
* @throws {ApiError} When request, applicant data, rate limit, or active-app rule fails.
*/
async function createApplicationDraft(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const draft = readNewDraft(await readJsonBody(request));
	const repositories = createRepositories(environment);
	await enforceRateLimit(repositories, request, APPLICATION_CREATE_RATE_LIMIT);
	const { application, token, accessCode } = await persistDraftWithSession(repositories, draft, requestId);
	return routeResult({
		application: createApplicationDto(application, environment),
		reference_number: application.reference_number,
		access_code: accessCode
	}, {
		status: 201,
		cookie: createSessionCookie("application", token, APPLICATION_SESSION_SECONDS)
	});
}
/**
* Reads the applicant's current draft through its opaque session cookie.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Student-safe application data.
* @throws {ApiError} When the request method or applicant session is invalid.
*/
async function readCurrentApplication(request, environment) {
	requireMethod(request, "GET");
	const session = await requireApplicationSession(request, environment);
	const application = await createD1Repositories(environment.DB).applications.findById(session.application_id);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	return { application: createApplicationDto(application, environment) };
}
/**
* Updates only the allowlisted fields of the applicant's current draft.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation ID for the audit event.
* @returns {Promise<object>} Updated student-safe application data.
* @throws {ApiError} When the session, state, or input is invalid.
*/
async function updateCurrentApplicationFields(request, environment, requestId, { allowIncomplete }) {
	requireSameOrigin(request);
	const session = await requireApplicationSession(request, environment);
	if (session.status !== "draft") throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Bu başvuru artık düzenlenemez.");
	const repositories = createRepositories(environment);
	const currentApplication = await repositories.applications.findById(session.application_id);
	if (!currentApplication) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	const body = await readJsonBody(request);
	if (!Number.isSafeInteger(body.lock_version) || body.lock_version < 1) throw new ApiError(400, "LOCK_VERSION_REQUIRED", "Güncel başvuru sürümü gerekli. Sayfayı yenileyip tekrar deneyin.");
	let expectedLockVersion = body.lock_version;
	let renumberedApplication = null;
	if (Object.hasOwn(body, "student_number")) {
		const submittedNumber = requireString(body, "student_number", {
			min: 0,
			max: 64
		});
		const isChanged = submittedNumber.length > 0 && normalizeStudentNumber(submittedNumber) !== normalizeStudentNumber(currentApplication.student_number);
		if (submittedNumber.length === 0 && !allowIncomplete) throw new ApiError(400, "VALIDATION_ERROR", "Öğrenci numarasını kontrol edip tekrar deneyin.");
		if (isChanged) {
			try {
				renumberedApplication = await repositories.applications.changeDraftStudentNumber({
					applicationId: session.application_id,
					studentId: crypto.randomUUID(),
					studentNumber: submittedNumber,
					expectedLockVersion,
					ownerSessionId: session.session_id
				});
			} catch (error) {
				if (error instanceof ApplicationConflictError) {
					if (error.code === "APPLICATION_UPDATE_CONFLICT") throw new ApiError(409, error.code, "Başvurunuz başka bir cihaz veya sekmede güncellendi. Lütfen sayfayı yenileyip en güncel bilgileri kontrol edin.");
					throw new ApiError(409, error.code, "Bu öğrenci numarası için zaten etkin bir başvuru bulunuyor.");
				}
				throw error;
			}
			if (!renumberedApplication) throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Bu başvuru artık düzenlenemez.");
			expectedLockVersion = renumberedApplication.lock_version;
			await createAuditEvent(repositories, {
				eventType: "application.draft_updated",
				actorType: "student",
				applicationId: session.application_id,
				requestId,
				metadata: { changedFields: "studentNumber" }
			});
		}
	}
	if (Object.keys(body).filter((key) => !["lock_version", "student_number"].includes(key)).length === 0) {
		if (!Object.hasOwn(body, "student_number")) throw new ApiError(400, "VALIDATION_ERROR", "Güncellenecek başvuru bilgisi gerekli.");
		return { application: createApplicationDto(renumberedApplication || currentApplication, environment) };
	}
	const changes = readDraftChanges(body, renumberedApplication || currentApplication, { allowIncomplete });
	let application;
	try {
		application = await repositories.applications.updateDraft(session.application_id, changes, {
			auditEventId: crypto.randomUUID(),
			requestId,
			ownerSessionId: session.session_id
		}, expectedLockVersion);
	} catch (error) {
		if (error.code === "APPLICATION_TYPE_CHANGE_BLOCKED") throw new ApiError(409, error.code, "Başvuru türü, mevcut belge geçmişi güvenle korunamadığı için değiştirilemedi.");
		if (error.code === "APPLICATION_UPDATE_CONFLICT") throw new ApiError(409, error.code, "Başvurunuz başka bir cihaz veya sekmede güncellendi. Lütfen sayfayı yenileyip en güncel bilgileri kontrol edin.");
		throw error;
	}
	if (!application) throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Bu başvuru artık düzenlenemez.");
	await createAuditEvent(repositories, {
		eventType: "application.draft_updated",
		actorType: "student",
		applicationId: session.application_id,
		requestId,
		metadata: { changedFields: Object.keys(changes).sort().join(",") }
	});
	return { application: createApplicationDto(application, environment) };
}
/**
* Saves a validated patch of the current applicant's draft.
* @param {Request} request Owner-session request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation identifier.
* @returns {Promise<object>} Student-safe updated application.
*/
async function updateCurrentApplication(request, environment, requestId) {
	requireMethod(request, "PATCH");
	return updateCurrentApplicationFields(request, environment, requestId, { allowIncomplete: false });
}
/**
* Saves an incomplete draft patch while the student is still editing a field.
* @param {Request} request Owner-session request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation identifier.
* @returns {Promise<object>} Student-safe updated application.
*/
async function autosaveCurrentApplication(request, environment, requestId) {
	requireMethod(request, "PATCH");
	return updateCurrentApplicationFields(request, environment, requestId, { allowIncomplete: true });
}
/**
* Accepts the current configurable acknowledgement and records its server timestamp atomically with audit.
* @param {Request} request Owner-session request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation identifier.
* @returns {Promise<object>} Student-safe accepted application DTO.
* @throws {ApiError} When ownership, origin, draft status, or current version validation fails.
*/
async function acceptCurrentApplicationDeclaration(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const session = await requireApplicationSession(request, environment);
	if (session.status !== "draft") throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Bu başvuru artık düzenlenemez.");
	const body = await readJsonBody(request);
	if (Object.keys(body).some((key) => !["accepted", "version"].includes(key)) || body.accepted !== true || typeof body.version !== "string") throw new ApiError(400, "DECLARATION_ACCEPTANCE_REQUIRED", "Devam etmek için başvuru bilgilendirmesini onaylayın.");
	const currentVersion = readDeclarationVersion(environment);
	if (body.version !== currentVersion) throw new ApiError(409, "DECLARATION_VERSION_CONFLICT", "Başvuru bilgilendirmesi güncellendi. Lütfen yeniden okuyup onaylayın.");
	const application = await createRepositories(environment).applications.acceptDeclaration({
		applicationId: session.application_id,
		version: currentVersion,
		acceptedAt: (/* @__PURE__ */ new Date()).toISOString(),
		auditEventId: crypto.randomUUID(),
		requestId
	});
	if (!application) throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Bu başvuru artık düzenlenemez.");
	return { application: createApplicationDto(application, environment) };
}
/**
* Records an explicit, current-version contact responsibility acknowledgement for the draft.
* @param {Request} request Owner-session request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation identifier.
* @returns {Promise<object>} Student-safe application with the persisted acknowledgement state.
* @throws {ApiError} When origin, session, draft state, contact details, or acknowledgement version is invalid.
*/
async function acceptCurrentContactAcknowledgement(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const session = await requireApplicationSession(request, environment);
	if (session.status !== "draft") throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Bu başvuru artık düzenlenemiyor.");
	const body = await readJsonBody(request);
	if (Object.keys(body).some((key) => !["accepted", "version"].includes(key)) || body.accepted !== true || typeof body.version !== "string") throw new ApiError(400, "CONTACT_ACKNOWLEDGEMENT_REQUIRED", "İletişim sorumluluğu onayını kabul ederek devam edin.");
	if (body.version !== "contact-reachability-v1") throw new ApiError(409, "CONTACT_ACKNOWLEDGEMENT_VERSION_CONFLICT", "İletişim onayı güncellendi. Lütfen metni yeniden okuyup kabul edin.");
	const repositories = createRepositories(environment);
	await enforceRateLimit(repositories, request, {
		endpoint: "contact-acknowledgement",
		maxRequests: 20,
		windowSeconds: 900
	});
	const currentApplication = await repositories.applications.findById(session.application_id);
	if (!currentApplication) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentApplication.student_email || "") || !isValidPhoneNumber(currentApplication.student_phone)) throw new ApiError(400, "CONTACT_INFORMATION_INCOMPLETE", "Devam etmeden önce geçerli e-posta ve telefon bilgilerini girin.");
	const acceptedAt = (/* @__PURE__ */ new Date()).toISOString();
	const application = await repositories.applications.acceptContactResponsibilityAcknowledgement({
		applicationId: session.application_id,
		version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
		acceptedAt,
		requestId
	});
	if (!application) throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Bu başvuru artık düzenlenemiyor.");
	return { application: createApplicationDto(application, environment) };
}
/**
* Revokes the applicant session and expires its cookie.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Route result with an expired applicant cookie.
* @throws {ApiError} When method or request origin is invalid.
*/
async function logoutApplication(request, environment) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const token = readCookie(request, getSessionCookieName("application"));
	if (token && environment.DB) await createD1Repositories(environment.DB).sessions.revokeApplicationSession(await hashSessionToken(token), (/* @__PURE__ */ new Date()).toISOString());
	return routeResult({ success: true }, { cookie: createExpiredSessionCookie("application") });
}
/**
* Returns the current session's student-safe application status.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Safe status DTO selected through the opaque owner session.
* @throws {ApiError} When the applicant session is invalid or the application is missing.
*/
async function readCurrentApplicationStatus(request, environment) {
	requireMethod(request, "GET");
	const session = await requireApplicationSession(request, environment);
	const application = await createD1Repositories(environment.DB).applications.findCurrentStatusById(session.application_id);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	return { application: {
		status: application.status,
		application_type: application.application_type,
		updated_at: application.updated_at
	} };
}
/**
* Submits the current owner-session application after server-side readiness validation.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation ID for the submit audit event.
* @returns {Promise<object>} Safe submitted application DTO if server readiness permits transition.
* @throws {ApiError} When origin, session, state, or readiness validation fails.
*/
async function submitCurrentApplication(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const session = await requireApplicationSession(request, environment);
	const repositories = createRepositories(environment);
	const application = await repositories.applications.findCurrentStatusById(session.application_id);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	if (application.status !== "draft") throw new ApiError(409, "APPLICATION_NOT_SUBMITTABLE", "Bu başvuru gönderim için uygun durumda değil.");
	if ((await readSubmissionReadiness(session.application_id, environment, readDeclarationVersion(environment))).status !== "ready") throw new ApiError(409, "SUBMISSION_NOT_READY", "Başvuru bilgileri ve gerekli belgeler tamamlanmadığı için gönderim yapılamıyor.");
	const submitted = await repositories.applications.submitDraft({
		applicationId: session.application_id,
		submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
		auditEventId: crypto.randomUUID(),
		requestId
	});
	if (!submitted) throw new ApiError(409, "APPLICATION_NOT_SUBMITTABLE", "Bu başvuru gönderim için uygun durumda değil.");
	return { application: createApplicationDto(submitted, environment) };
}
/** @param {object} input Failed credential request context. @returns {Promise<never>} Rejects without locking valid owners. @throws {ApiError} Invalid credentials or failed-attempt quota. */
async function rejectAccessCredentials({ repositories, request, referenceNumber }) {
	await enforceRateLimit(repositories, request, {
		endpoint: "application-access-ip",
		maxRequests: 60,
		windowSeconds: 900
	});
	if (isValidApplicationReference(referenceNumber)) {
		if (!await consumePublicRateLimit(repositories.rateLimits, {
			endpoint: "application-access-ref",
			identity: referenceNumber,
			nowSeconds: Math.floor(Date.now() / 1e3),
			maxRequests: 5,
			windowSeconds: 900
		})) throw new ApiError(429, "RATE_LIMITED", "Çok fazla hatalı deneme yapıldı. Daha sonra tekrar deneyin.", true);
	}
	throw new ApiError(401, "INVALID_CREDENTIALS", "Başvuru numarası veya öğrenci numarası hatalı.");
}
/**
* Verifies application reference and student number, issuing a new owner session for another device.
* Enforces rate limiting on both IP level (broad NAT tolerance) and reference level (strict anti-brute-force).
* @param {Request} request Public JSON POST request.
* @param {object} environment Cloudflare Worker bindings.
* @param {string} requestId Correlation identifier.
* @returns {Promise<object>} Route result with student-safe DTO and new session cookie.
* @throws {ApiError} When input, rate limit, reference, or student number is invalid.
*/
async function accessApplicationWithReference(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const body = await readJsonBody(request);
	const rawRef = body.reference_number;
	const rawStudentNumber = body.student_number;
	const rawCode = body.access_code;
	if (!rawRef || typeof rawRef !== "string" || !rawStudentNumber && !rawCode) throw new ApiError(400, "INVALID_INPUT", "Başvuru numarası ve öğrenci numarası zorunludur.");
	const repositories = createRepositories(environment);
	const referenceNumber = normalizeApplicationReference(rawRef);
	if (!isValidApplicationReference(referenceNumber)) return rejectAccessCredentials({
		repositories,
		request,
		referenceNumber
	});
	let application = null;
	if (rawStudentNumber && typeof rawStudentNumber === "string") {
		let submittedStudentNumber;
		try {
			submittedStudentNumber = normalizeStudentNumber(rawStudentNumber);
		} catch {
			return rejectAccessCredentials({
				repositories,
				request,
				referenceNumber
			});
		}
		application = await repositories.applications.findByReferenceNumber(referenceNumber);
		if (!application || [
			"completed",
			"cancelled",
			"rejected"
		].includes(application.status) || !constantTimeCompare(submittedStudentNumber, normalizeStudentNumber(application.student_number))) return rejectAccessCredentials({
			repositories,
			request,
			referenceNumber
		});
	} else if (rawCode && typeof rawCode === "string") {
		if (!isValidAccessCodeFormat(rawCode)) return rejectAccessCredentials({
			repositories,
			request,
			referenceNumber
		});
		application = await repositories.applications.findByReferenceNumber(referenceNumber);
		if (!application || !application.access_code_hash || [
			"completed",
			"cancelled",
			"rejected"
		].includes(application.status)) {
			await verifyAccessCode(rawCode, "0000000000000000000000000000000000000000000000000000000000000000");
			return rejectAccessCredentials({
				repositories,
				request,
				referenceNumber
			});
		}
		if (!await verifyAccessCode(rawCode, application.access_code_hash)) return rejectAccessCredentials({
			repositories,
			request,
			referenceNumber
		});
	} else return rejectAccessCredentials({
		repositories,
		request,
		referenceNumber
	});
	const token = createOpaqueSessionToken();
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	if (!await repositories.sessions.createApplicationSessionGuarded({
		id: crypto.randomUUID(),
		applicationId: application.id,
		tokenHash: await hashSessionToken(token),
		expiresAt: new Date(Date.parse(createdAt) + APPLICATION_SESSION_SECONDS * 1e3).toISOString(),
		createdAt,
		expectedAccessCodeVersion: application.access_code_version
	})) return rejectAccessCredentials({
		repositories,
		request,
		referenceNumber
	});
	await createAuditEvent(repositories, {
		eventType: "application.cross_device_access",
		actorType: "student",
		applicationId: application.id,
		requestId,
		metadata: { referenceNumber: application.reference_number }
	});
	return routeResult({
		success: true,
		application: createApplicationDto(application, environment)
	}, {
		status: 200,
		cookie: createSessionCookie("application", token, APPLICATION_SESSION_SECONDS)
	});
}
async function regenerateCurrentAccessCode(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const session = await requireApplicationSession(request, environment);
	if ([
		"completed",
		"cancelled",
		"rejected"
	].includes(session.status)) throw new ApiError(409, "APPLICATION_TERMINAL", "Sonuçlanmış başvurularda erişim kodu yenilenemez.");
	const repositories = createRepositories(environment);
	await enforceRateLimit(repositories, request, {
		endpoint: "application-regenerate-code",
		maxRequests: 3,
		windowSeconds: 900
	});
	const newCode = generateAccessCode();
	const newHash = await hashAccessCode(newCode);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const updated = await repositories.applications.updateAccessCode({
		applicationId: session.application_id,
		accessCodeHash: newHash,
		accessCodeCreatedAt: now,
		auditEventId: crypto.randomUUID(),
		requestId,
		expectedAccessCodeVersion: session.access_code_version,
		ownerSessionId: session.session_id,
		actorType: "student"
	});
	if (!updated) throw new ApiError(409, "APPLICATION_NOT_EDITABLE", "Erişim kodu güncellenemedi.");
	return {
		success: true,
		reference_number: updated.reference_number,
		access_code: newCode
	};
}
async function resetStaffApplicationAccessCode({ request, environment, applicationId, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const staff = await requireStaff(request, environment, ["admin", "reviewer"]);
	const repositories = createRepositories(environment);
	const application = await repositories.applications.findById(applicationId);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	const newCode = generateAccessCode();
	const newHash = await hashAccessCode(newCode);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const updated = await repositories.applications.updateAccessCode({
		applicationId,
		accessCodeHash: newHash,
		accessCodeCreatedAt: now,
		auditEventId: crypto.randomUUID(),
		requestId,
		expectedAccessCodeVersion: application.access_code_version,
		actorType: "staff",
		actorStaffId: staff.id
	});
	if (!updated) throw new ApiError(409, "ACCESS_CODE_ROTATION_CONFLICT", "Başvuru veya erişim kodu değişti. Güncel durumu yeniden kontrol edin.");
	return {
		success: true,
		reference_number: updated.reference_number,
		access_code: newCode
	};
}
//#endregion
//#region src/server/routes/applicationTrackingRoutes.js
function isStudentVisibleFile(requirement) {
	return requirement?.upload_status === "finalized" && ["pending", "clean"].includes(requirement.scan_status);
}
function readStudentDocumentStatus(requirement) {
	if (requirement?.review_status === "resubmission_required" || requirement?.revision_status === "resubmission_required") return "resubmission_required";
	if (requirement?.review_status === "approved" || requirement?.revision_status === "approved") return "approved";
	if (requirement?.review_status === "under_review") return "under_review";
	if (isStudentVisibleFile(requirement)) return "waiting_review";
	return "not_uploaded";
}
function createTrackingDocumentDto(policy, requirement) {
	return {
		code: policy.code,
		label_key: policy.label_key,
		required: policy.required,
		revision_number: requirement?.revision_number ?? null,
		status: readStudentDocumentStatus(requirement),
		filename: isStudentVisibleFile(requirement) ? requirement.original_filename ?? null : null,
		...typeof requirement?.student_message === "string" ? { student_message: requirement.student_message } : {}
	};
}
function createPublicTrackingDocumentDto(policy, requirement) {
	return {
		code: policy.code,
		label_key: policy.label_key,
		required: policy.required,
		status: readStudentDocumentStatus(requirement),
		...typeof requirement?.student_message === "string" ? { student_message: requirement.student_message } : {}
	};
}
function createTrackingApplicationDto(application) {
	return {
		student_number: application.student_number,
		status: application.status,
		application_type: application.application_type,
		created_at: application.created_at ?? null,
		updated_at: application.updated_at ?? null,
		submitted_at: application.submitted_at ?? null
	};
}
function createDocumentTrackingView(application, storedRequirements, createDto) {
	const policies = listDocumentPolicies(application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null);
	const requirementsByCode = new Map(storedRequirements.map((requirement) => [requirement.code, requirement]));
	return policies.map((policy) => createDto(policy, requirementsByCode.get(policy.code)));
}
/**
* Reads current application tracking data using only the authenticated applicant session.
* @param {Request} request Request carrying the applicant HttpOnly session cookie.
* @param {object} environment Worker bindings containing D1.
* @returns {Promise<object>} Student-safe application and applicable document tracking DTO.
* @throws {ApiError} When the session or its application is unavailable.
*/
async function readCurrentApplicationTracking(request, environment) {
	requireMethod(request, "GET");
	const session = await requireApplicationSession(request, environment);
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(session.application_id);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	const [storedRequirements, studentMessages] = await Promise.all([repositories.documents.listStudentRequirements(application.id), repositories.applicationNotes.listLatestStudentDocumentMessages(application.id)]);
	const requirementsWithMessages = storedRequirements.map((requirement) => ({
		...requirement,
		student_message: studentMessages.get(requirement.document_record_id)
	}));
	return {
		application: createTrackingApplicationDto(application),
		documents: createDocumentTrackingView(application, requirementsWithMessages, createTrackingDocumentDto)
	};
}
/**
* Reads a privacy-minimized public tracking view by normalized student number.
* @param {Request} request Same-origin JSON POST request.
* @param {object} environment Worker bindings containing D1.
* @returns {Promise<object>} Public-safe tracking result, or an indistinguishable not-found result.
* @throws {ApiError} When method, origin, body, or rate policy is invalid.
*/
async function lookupApplicationTracking(request, environment) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const body = await readJsonBody(request);
	if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "student_number")) throw new ApiError(400, "VALIDATION_ERROR", "Öğrenci numarasını kontrol edip tekrar deneyin.");
	let studentNumber;
	try {
		studentNumber = normalizeStudentNumber(body.student_number);
	} catch {
		throw new ApiError(400, "VALIDATION_ERROR", "Öğrenci numarasını kontrol edip tekrar deneyin.");
	}
	const repositories = createD1Repositories(environment.DB);
	await enforceRateLimit(repositories, request, APPLICATION_TRACKING_RATE_LIMIT);
	const application = await repositories.applications.findTrackableByStudentNumber(studentNumber);
	if (!application) return {
		found: false,
		application: null,
		documents: []
	};
	const [storedRequirements, studentMessages] = await Promise.all([repositories.documents.listStudentRequirements(application.id), repositories.applicationNotes.listLatestStudentDocumentMessages(application.id)]);
	const requirementsWithMessages = storedRequirements.map((requirement) => ({
		...requirement,
		student_message: studentMessages.get(requirement.document_record_id)
	}));
	return {
		found: true,
		application: createTrackingApplicationDto(application),
		documents: createDocumentTrackingView(application, requirementsWithMessages, createPublicTrackingDocumentDto)
	};
}
//#endregion
//#region src/server/routes/documentRoutes.js
/**
* Removes paths, control characters, and unsupported characters from a download filename.
* @param {string} filename Original private document filename.
* @returns {string} Safe ASCII filename for Content-Disposition.
*/
function createSafeFilename(filename) {
	return ((filename.split(/[\\/]/).pop() || "document").normalize("NFKC").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[. ]+|[. ]+$/g, "") || "document").slice(0, 120);
}
/**
* Checks whether the existing private-document media allowlist accepts a media type.
* @param {string} mediaType Persisted document media type.
* @returns {boolean} True when staff may receive document content in this type.
*/
function isSafeDocumentMediaType(mediaType) {
	return [
		"application/pdf",
		"image/jpeg",
		"image/png",
		"image/webp"
	].includes(mediaType);
}
/**
* Builds the shared, private attachment response for a validated current document.
* @param {object} file Authorized file metadata owned by the server.
* @param {object} object Private R2 object with a readable body.
* @returns {Response} Safe attachment response.
*/
function createPrivateAttachmentResponse(file, object) {
	const headers = new Headers({
		"Content-Type": file.media_type,
		"Content-Disposition": `attachment; filename="${createSafeFilename(file.original_filename)}"`,
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff"
	});
	if (Number.isSafeInteger(file.byte_size) && file.byte_size >= 0) headers.set("Content-Length", String(file.byte_size));
	return new Response(object.body, {
		status: 200,
		headers
	});
}
/**
* Returns clean finalized document bytes to an authenticated staff member.
* @param {Request} request Fetch API request.
* @param {object} environment Worker D1 and private R2 bindings.
* @param {string} fileId Persisted document file identifier.
* @returns {Promise<Response>} Private attachment response.
* @throws {ApiError} When authorization, metadata, or storage checks fail.
*/
async function readPrivateDocument(request, environment, fileId) {
	requireMethod(request, "GET");
	await requireStaff(request, environment);
	if (!environment.DB || !environment.DOCUMENTS) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Belge hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.", true);
	if (typeof fileId !== "string" || fileId.length < 1 || fileId.length > 128) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Belge bulunamadı.");
	const file = await createD1Repositories(environment.DB).documents.findPrivateFileById(fileId);
	if (!file || !isSafeDocumentMediaType(file.media_type)) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Belge bulunamadı.");
	const object = await createDocumentStorage(environment).get(file.storage_key);
	if (!object?.body) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Belge bulunamadı.");
	return createPrivateAttachmentResponse(file, object);
}
//#endregion
//#region src/server/domain/resubmissionUploadPolicy.js
function hasCompatibleRecord(input) {
	return input.application?.status === "resubmission_required" && input.policyIsApplicable === true && input.documentRecord?.id && input.documentRecord.applicationId === input.application.id && input.hasStudentMessageForDocument === true;
}
function hasCurrentRevision(input) {
	return input.currentRevision?.documentRecordId === input.documentRecord?.id && input.currentRevision.isCurrent === true && input.currentRevision.file?.cleanupStatus !== "pending";
}
function isFirstReplacement(input) {
	return hasCurrentRevision(input) && input.documentRecord.reviewStatus === "resubmission_required" && input.currentRevision.status === "resubmission_required" && input.currentRevision.file?.uploadStatus === "finalized" && input.currentRevision.file?.intentStatus === "completed" && [
		"clean",
		"unsafe",
		"failed"
	].includes(input.currentRevision.file?.scanStatus);
}
function isUnsafeScanRetry(input) {
	return hasCurrentRevision(input) && input.documentRecord.reviewStatus === "pending" && input.currentRevision.status === "submitted" && input.currentRevision.file?.uploadStatus === "finalized" && input.currentRevision.file?.intentStatus === "completed" && ["unsafe", "failed"].includes(input.currentRevision.file?.scanStatus);
}
/**
* Evaluates the persisted facts required for an initial replacement or unsafe-scan retry.
* @param {object} input Server-loaded application, record, revision, file, policy, and note facts.
* @returns {{allowed: boolean, mode: 'first_replacement'|'unsafe_scan_retry'|null}} Eligibility hint.
*/
function evaluateResubmissionEligibility(input) {
	if (!hasCompatibleRecord(input)) return {
		allowed: false,
		mode: null
	};
	if (isFirstReplacement(input)) return {
		allowed: true,
		mode: "first_replacement"
	};
	if (isUnsafeScanRetry(input)) return {
		allowed: true,
		mode: "unsafe_scan_retry"
	};
	return {
		allowed: false,
		mode: null
	};
}
//#endregion
//#region src/server/routes/resubmissionUploadRoutes.js
var INTENT_LIFETIME_SECONDS = 600;
var SIGNED_PUT_LIFETIME_SECONDS = 300;
function requireExactKeys(body, allowedKeys) {
	if (Object.keys(body).every((key) => allowedKeys.includes(key))) return;
	throw new ApiError(400, "VALIDATION_ERROR", "Belge yüklemesini kontrol edip tekrar deneyin.");
}
function createEligibilityInput(row, policy) {
	return {
		application: {
			id: row.application_id,
			status: row.application_status
		},
		policyIsApplicable: Boolean(policy && row.is_required),
		documentRecord: row.document_record_id ? {
			id: row.document_record_id,
			applicationId: row.application_id,
			reviewStatus: row.review_status
		} : null,
		currentRevision: row.current_revision_id ? {
			id: row.current_revision_id,
			documentRecordId: row.document_record_id,
			status: row.revision_status,
			isCurrent: row.is_current === 1,
			file: {
				uploadStatus: row.upload_status,
				scanStatus: row.scan_status,
				cleanupStatus: row.cleanup_status,
				intentStatus: row.upload_intent_status
			}
		} : null,
		hasStudentMessageForDocument: row.has_student_message_for_document === 1
	};
}
function readEligibleRow(rows, code) {
	const row = rows.find((entry) => entry.code === code);
	if (!row) return null;
	const policy = readDocumentPolicy(code, row.application_type, row.is_under_18 === 1, row.address_evidence_type ?? null);
	const eligibility = evaluateResubmissionEligibility(createEligibilityInput(row, policy));
	if (!eligibility.allowed) return null;
	return {
		row,
		policy,
		mode: eligibility.mode
	};
}
async function readOwnerContext(request, environment) {
	const session = await requireApplicationSession(request, environment);
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(session.application_id);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	return {
		application,
		repositories,
		rows: await repositories.resubmissionUploads.readEligibility(application.id)
	};
}
function createIntentResponse(intentId, capability, expiresAt) {
	return { upload: {
		intent_id: intentId,
		method: capability.method,
		url: capability.url,
		required_headers: capability.requiredHeaders,
		capability_expires_at: capability.expiresAt,
		intent_expires_at: expiresAt
	} };
}
function createCleanupStorage(environment) {
	try {
		return createDocumentStorage(environment);
	} catch {
		return null;
	}
}
async function retryExpiredCleanup(repositories, applicationId, storage, code) {
	if (!storage) return;
	const cleanupFiles = await repositories.resubmissionUploads.listRetryableCleanup(applicationId, code);
	for (const file of cleanupFiles) try {
		await storage.delete(file.storage_key);
		await repositories.resubmissionUploads.markCleanupComplete(applicationId, file.id);
	} catch {}
}
async function expireAbandonedIntents(repositories, applicationId) {
	const expiredIntents = await repositories.resubmissionUploads.listExpiredPendingIntents(applicationId);
	for (const intent of expiredIntents) await repositories.resubmissionUploads.expireIntent(applicationId, intent.id, (/* @__PURE__ */ new Date()).toISOString());
}
/**
* Returns a non-authoritative replacement hint for the owner tracking UI.
* @param {Request} request Owner-session GET request.
* @param {object} environment Worker bindings containing D1.
* @returns {Promise<{documents: Array<object>}>} Policy-safe eligible document hints.
* @throws {ApiError} When the owner session or application cannot be read.
*/
async function readCurrentResubmissionEligibility(request, environment) {
	requireMethod(request, "GET");
	const { application, repositories, rows } = await readOwnerContext(request, environment);
	await expireAbandonedIntents(repositories, application.id);
	await retryExpiredCleanup(repositories, application.id, createCleanupStorage(environment));
	const policies = listDocumentPolicies(application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null);
	return { documents: rows.flatMap((row) => {
		const policy = policies.find((entry) => entry.code === row.code);
		const eligibility = evaluateResubmissionEligibility(createEligibilityInput(row, policy));
		if (!eligibility.allowed) return [];
		return [{
			code: row.code,
			label_key: policy.label_key,
			mode: eligibility.mode,
			accepted_media_types: policy.accepted_media_types,
			max_byte_size: policy.max_byte_size
		}];
	}) };
}
/**
* Creates an owner-bound replacement revision and quarantine upload capability.
* @param {Request} request Same-origin request containing code and safe file metadata.
* @param {object} environment Worker bindings for D1 and private R2.
* @param {string} requestId Worker request correlation ID.
* @returns {Promise<object>} Opaque intent and signed upload capability response.
* @throws {ApiError} When session, policy, metadata, storage, or persisted-state checks fail.
*/
async function createCurrentResubmissionUploadIntent(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const { application, repositories, rows } = await readOwnerContext(request, environment);
	const body = await readJsonBody(request);
	requireExactKeys(body, [
		"code",
		"filename",
		"media_type",
		"byte_size"
	]);
	await expireAbandonedIntents(repositories, application.id);
	const eligible = readEligibleRow(rows, typeof body.code === "string" ? body.code.trim() : "");
	if (!eligible) throw new ApiError(409, "RESUBMISSION_NOT_AVAILABLE", "Bu belge için güvenli yeniden yükleme açılamıyor.");
	const metadata = readStudentUploadMetadata(body, eligible.policy);
	await retryExpiredCleanup(repositories, application.id, createCleanupStorage(environment));
	const now = /* @__PURE__ */ new Date();
	const createdAt = now.toISOString();
	const expiresAt = new Date(now.valueOf() + INTENT_LIFETIME_SECONDS * 1e3).toISOString();
	const storage = createDocumentStorage(environment);
	const storageKey = storage.createQuarantineKey();
	const intentId = crypto.randomUUID();
	const revisionId = crypto.randomUUID();
	const fileId = crypto.randomUUID();
	let capability;
	try {
		capability = await storage.createWriteOnceUploadCapability(storageKey, {
			contentType: metadata.mediaType,
			expiresInSeconds: SIGNED_PUT_LIFETIME_SECONDS
		});
	} catch {
		throw new ApiError(503, "STORAGE_UNAVAILABLE", "Belge yükleme hizmeti şu anda kullanılamıyor.", true);
	}
	if (!await repositories.resubmissionUploads.createIntent({
		applicationId: application.id,
		applicationType: application.application_type,
		isUnder18: application.is_under_18 === 1,
		addressEvidenceType: application.address_evidence_type ?? null,
		code: metadata.code,
		requirementId: eligible.row.requirement_id,
		conditionalRule: eligible.policy.conditional_rule,
		documentRecordId: eligible.row.document_record_id,
		expectedCurrentRevisionId: eligible.row.current_revision_id,
		mode: eligible.mode,
		revisionId,
		fileId,
		storageKey,
		filename: metadata.filename,
		mediaType: metadata.mediaType,
		byteSize: metadata.byteSize,
		intentId,
		idempotencyKey: crypto.randomUUID(),
		expiresAt,
		createdAt
	})) throw new ApiError(409, "RESUBMISSION_UPLOAD_CONFLICT", "Belge durumu değişti. Listeyi yenileyip tekrar deneyin.");
	return routeResult(createIntentResponse(intentId, capability, expiresAt), { status: 201 });
}
function requireIntentId(body) {
	requireExactKeys(body, ["intent_id"]);
	if (typeof body.intent_id === "string" && /^[0-9a-f-]{36}$/i.test(body.intent_id)) return body.intent_id;
	throw new ApiError(400, "VALIDATION_ERROR", "Belge yüklemesini doğrulayıp tekrar deneyin.");
}
function objectMatchesIntent(object, intent, policy) {
	return Boolean(object && policy && object.size === intent.byte_size && object.size <= policy.max_byte_size && policy.accepted_media_types.includes(object.httpMetadata?.contentType) && object.httpMetadata?.contentType === intent.media_type);
}
async function invalidateIntentAndQueueCleanup(repositories, intent, status = "rejected") {
	if (status === "expired") {
		await repositories.resubmissionUploads.expireIntent(intent.application_id, intent.id, (/* @__PURE__ */ new Date()).toISOString());
		return;
	}
	await repositories.resubmissionUploads.invalidatePendingIntent(intent.application_id, intent.document_record_id, intent.id, (/* @__PURE__ */ new Date()).toISOString());
}
/**
* Verifies the quarantine object and atomically makes the replacement current.
* @param {Request} request Same-origin request containing only the opaque intent ID.
* @param {object} environment Worker bindings for D1 and private R2.
* @param {string} requestId Worker request correlation ID for the atomic audit record.
* @returns {Promise<object>} Student-safe finalized document state.
* @throws {ApiError} When owner authority, intent, eligibility, object, or finalize guard fails.
*/
async function finalizeCurrentResubmissionUpload(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const { application, repositories, rows } = await readOwnerContext(request, environment);
	const intentId = requireIntentId(await readJsonBody(request));
	const intent = await repositories.resubmissionUploads.findIntent(application.id, intentId);
	if (!intent) throw new ApiError(404, "UPLOAD_INTENT_NOT_FOUND", "Belge yüklemesi bu başvuru için bulunamadı.");
	if (intent.intent_status !== "pending") throw new ApiError(409, "UPLOAD_INTENT_UNAVAILABLE", "Belge yükleme bağlantısı artık kullanılamıyor.");
	if (Date.parse(intent.expires_at) <= Date.now()) {
		await invalidateIntentAndQueueCleanup(repositories, intent, "expired");
		await retryExpiredCleanup(repositories, application.id, createCleanupStorage(environment), intent.code);
		throw new ApiError(409, "UPLOAD_INTENT_EXPIRED", "Belge yükleme süresi doldu. Yeni bir yükleme başlatın.");
	}
	const eligible = readEligibleRow(rows, intent.code);
	if (!eligible || eligible.row.document_record_id !== intent.document_record_id || eligible.row.current_revision_id !== intent.expected_current_revision_id || eligible.mode !== intent.mode) {
		await invalidateIntentAndQueueCleanup(repositories, intent);
		throw new ApiError(409, "RESUBMISSION_UPLOAD_CONFLICT", "Belge durumu değişti. Listeyi yenileyip tekrar deneyin.");
	}
	const object = await createDocumentStorage(environment).head(intent.storage_key);
	if (!objectMatchesIntent(object, intent, eligible.policy)) {
		await invalidateIntentAndQueueCleanup(repositories, intent);
		throw new ApiError(409, object ? "UPLOAD_OBJECT_MISMATCH" : "UPLOAD_OBJECT_MISSING", "Yüklenen belge doğrulanamadı. Güvenli bir yeniden yükleme başlatın.");
	}
	const finalizedAt = (/* @__PURE__ */ new Date()).toISOString();
	if (!await repositories.resubmissionUploads.finalizeReplacement({
		applicationId: application.id,
		applicationType: application.application_type,
		isUnder18: application.is_under_18 === 1,
		addressEvidenceType: application.address_evidence_type ?? null,
		requirementId: intent.requirement_id,
		code: intent.code,
		documentRecordId: intent.document_record_id,
		expectedCurrentRevisionId: intent.expected_current_revision_id,
		replacementRevisionId: intent.revision_id,
		replacementFileId: intent.file_id,
		intentId: intent.id,
		mode: intent.mode,
		revisionNumber: intent.revision_number,
		finalizedAt,
		requestId,
		auditId: crypto.randomUUID()
	})) {
		await invalidateIntentAndQueueCleanup(repositories, intent);
		throw new ApiError(409, "RESUBMISSION_UPLOAD_CONFLICT", "Belge durumu değişti. Güvenli yeniden yükleme başlatın.");
	}
	return { document: {
		code: intent.code,
		revision_number: intent.revision_number,
		upload_status: "finalized",
		scan_status: "pending"
	} };
}
//#endregion
//#region src/server/routes/staffDocumentAccessRoutes.js
var STAFF_ROLES$3 = Object.freeze(["reviewer", "admin"]);
var PREVIEW_TTL_SECONDS = 120;
var ZIP_ENTRY_EXTENSIONS = Object.freeze({
	"application/pdf": "pdf",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp"
});
function unavailableDocument() {
	return new ApiError(404, "DOCUMENT_NOT_AVAILABLE", "Belge mevcut değil veya erişilemiyor.");
}
function unavailableApplication() {
	return new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
}
function requireSameOriginArchiveRead(request) {
	const requestOrigin = new URL(request.url).origin;
	const origin = request.headers.get("Origin");
	const referer = request.headers.get("Referer");
	for (const candidate of [origin, referer]) {
		if (!candidate) continue;
		try {
			if (new URL(candidate).origin === requestOrigin) return;
		} catch {}
	}
	if (request.headers.get("Sec-Fetch-Site") === "same-origin") return;
	throw new ApiError(403, "CROSS_ORIGIN_REQUEST", "İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.");
}
async function resolveCurrentDocument(environment, applicationId, code) {
	if (!environment?.DB || !environment?.DOCUMENTS) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Belge hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.", true);
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(applicationId);
	if (!application || application.status === "draft") throw unavailableApplication();
	if ((await environment.DB.prepare(`SELECT state FROM application_deletions WHERE application_id=?`).bind(applicationId).first())?.state === "purge_pending") throw unavailableApplication();
	const policy = readDocumentPolicy(code, application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null);
	if (!policy) throw unavailableDocument();
	const file = await repositories.documents.findCurrentPrivateFileByApplicationAndCode(applicationId, code);
	if (!file || !isSafeDocumentMediaType(file.media_type) || !policy.accepted_media_types.includes(file.media_type)) throw unavailableDocument();
	return {
		repositories,
		application,
		file
	};
}
async function writeAccessAudit({ repositories, staff, application, file, code, requestId, eventType, result }) {
	await repositories.audit.writeEvent({
		id: crypto.randomUUID(),
		eventType,
		actorType: "staff",
		actorStaffId: staff.id,
		applicationId: application.id,
		documentRecordId: file.document_record_id,
		requestId,
		metadata: {
			documentCode: code,
			revisionNumber: file.revision_number,
			result
		}
	});
}
function archiveIdentity(applicationId, file, object) {
	const identitySource = [
		applicationId,
		file.id,
		file.revision_id,
		file.revision_number,
		object.etag,
		object.size
	].join("|");
	return crypto.subtle.digest("SHA-256", new TextEncoder().encode(identitySource)).then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}
async function resolveArchiveFile(environment, applicationId, code) {
	const resolved = await resolveCurrentDocument(environment, applicationId, code);
	const { file } = resolved;
	if (file.revision_status !== "submitted" && file.revision_status !== "approved" && file.revision_status !== "resubmission_required") throw unavailableDocument();
	if (file.upload_status !== "finalized" || file.scan_status !== "clean" || file.cleanup_status !== "none" || file.upload_intent_status !== "completed") throw unavailableDocument();
	const object = await createDocumentStorage(environment).head(file.storage_key);
	if (!object || !Number.isSafeInteger(object.size) || object.size !== file.byte_size || typeof object.etag !== "string" || !object.etag) throw unavailableDocument();
	return {
		...resolved,
		object,
		identity: await archiveIdentity(applicationId, file, object)
	};
}
function guardArchiveStream(body, environment, applicationId, code, expectedIdentity) {
	const reader = body.getReader();
	return new ReadableStream({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (!result.done) {
					controller.enqueue(result.value);
					return;
				}
				if ((await resolveArchiveFile(environment, applicationId, code)).identity !== expectedIdentity) throw new Error("Archive source changed.");
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel(reason) {
			await reader.cancel(reason);
		}
	});
}
/** Builds a safe manifest using only applicable current documents that pass every access gate. */
async function createStaffApplicationArchiveManifest({ request, environment, applicationId, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const staff = await requireStaff(request, environment, STAFF_ROLES$3);
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(applicationId);
	if (!application || application.status === "draft") throw unavailableApplication();
	const requirements = await repositories.documents.listStudentRequirements(applicationId);
	const files = [];
	let totalSourceBytes = 0;
	for (const requirement of requirements) {
		const policy = readDocumentPolicy(requirement.code, application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null);
		if (!policy || requirement.revision_number === null || requirement.revision_number === void 0) continue;
		const resolved = await resolveArchiveFile(environment, applicationId, requirement.code);
		if (resolved.file.revision_number !== requirement.revision_number) throw new ApiError(409, "DOCUMENT_CHANGED", "Belge listesi oluşturulurken değişti. ZIP işlemi iptal edildi.");
		const extension = ZIP_ENTRY_EXTENSIONS[resolved.file.media_type];
		if (!extension || !policy.accepted_media_types.includes(resolved.file.media_type) || resolved.file.byte_size > policy.max_byte_size) throw unavailableDocument();
		totalSourceBytes += resolved.file.byte_size;
		files.push({
			code: requirement.code,
			expected_revision_number: resolved.file.revision_number,
			object_identity: resolved.identity,
			media_type: resolved.file.media_type,
			byte_size: resolved.file.byte_size,
			entry_name: `${String(files.length + 1).padStart(2, "0")}-${requirement.code}.${extension}`
		});
	}
	await repositories.audit.writeEvent({
		id: crypto.randomUUID(),
		eventType: "staff.application_archive_requested",
		actorType: "staff",
		actorStaffId: staff.id,
		applicationId,
		requestId,
		metadata: { result: "manifest_prepared" }
	});
	return routeResult({
		files,
		total_source_bytes: totalSourceBytes
	});
}
/** Streams one manifest-pinned private object after revalidating its revision and R2 ETag. */
async function streamStaffApplicationArchiveFile({ request, environment, applicationId, code, requestId }) {
	requireMethod(request, "GET");
	requireSameOriginArchiveRead(request);
	const staff = await requireStaff(request, environment, STAFF_ROLES$3);
	const parameters = new URL(request.url).searchParams;
	const expectedRevision = Number(parameters.get("revision"));
	const expectedIdentity = parameters.get("identity");
	if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !/^[a-f0-9]{64}$/.test(expectedIdentity || "")) throw unavailableDocument();
	const resolved = await resolveArchiveFile(environment, applicationId, code);
	if (resolved.file.revision_number !== expectedRevision || resolved.identity !== expectedIdentity) throw new ApiError(409, "DOCUMENT_CHANGED", "Belge listesi değişti. ZIP işlemi iptal edildi.");
	const object = await createDocumentStorage(environment).get(resolved.file.storage_key, { etagMatches: resolved.object.etag });
	if (!object?.body || object.size !== resolved.file.byte_size || object.etag !== resolved.object.etag) throw new ApiError(409, "DOCUMENT_CHANGED", "Belge artık güvenli biçimde indirilemiyor. ZIP işlemi iptal edildi.");
	await writeAccessAudit({
		repositories: resolved.repositories,
		staff,
		application: resolved.application,
		file: resolved.file,
		code,
		requestId,
		eventType: "staff.application_archive_document_stream_authorized",
		result: "stream_authorized"
	});
	return new Response(guardArchiveStream(object.body, environment, applicationId, code, resolved.identity), {
		status: 200,
		headers: {
			"Content-Type": resolved.file.media_type,
			"Content-Length": String(resolved.file.byte_size),
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff"
		}
	});
}
/**
* Issues a short-lived capability for one authorized, clean current application document.
* @param {{request: Request, environment: object, applicationId: string, code: string, requestId: string}} input Validated route context.
* @returns {Promise<object>} Safe capability DTO for the authenticated staff UI.
*/
async function createStaffDocumentPreview({ request, environment, applicationId, code, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const staff = await requireStaff(request, environment, STAFF_ROLES$3);
	const resolved = await resolveCurrentDocument(environment, applicationId, code);
	const storage = createDocumentStorage(environment);
	if (!await storage.head(resolved.file.storage_key)) throw unavailableDocument();
	let capability;
	try {
		capability = await storage.createReadCapability(resolved.file.storage_key, { expiresInSeconds: PREVIEW_TTL_SECONDS });
	} catch {
		throw new ApiError(503, "SERVICE_UNAVAILABLE", "Belge önizlemesi şu anda açılamıyor. Daha sonra tekrar deneyin.", true);
	}
	await writeAccessAudit({
		repositories: resolved.repositories,
		staff,
		application: resolved.application,
		file: resolved.file,
		code,
		requestId,
		eventType: "staff.document_preview_issued",
		result: "capability_issued"
	});
	return routeResult({
		method: capability.method,
		url: capability.url,
		expires_at: capability.expiresAt,
		media_type: resolved.file.media_type,
		filename: createSafeFilename(resolved.file.original_filename)
	});
}
/**
* Returns one authorized, clean current application document as a private attachment.
* @param {{request: Request, environment: object, applicationId: string, code: string, requestId: string}} input Validated route context.
* @returns {Promise<Response>} Safe attachment response.
*/
async function downloadStaffApplicationDocument({ request, environment, applicationId, code, requestId }) {
	requireMethod(request, "GET");
	const staff = await requireStaff(request, environment, STAFF_ROLES$3);
	const resolved = await resolveCurrentDocument(environment, applicationId, code);
	const object = await createDocumentStorage(environment).get(resolved.file.storage_key);
	if (!object?.body) throw unavailableDocument();
	await writeAccessAudit({
		repositories: resolved.repositories,
		staff,
		application: resolved.application,
		file: resolved.file,
		code,
		requestId,
		eventType: "staff.document_downloaded",
		result: "downloaded"
	});
	return createPrivateAttachmentResponse(resolved.file, object);
}
//#endregion
//#region src/server/domain/applicationStateMachine.js
var STATUS_TRANSITIONS = Object.freeze({
	submitted: Object.freeze(["under_review"]),
	resubmission_required: Object.freeze(["under_review"]),
	under_review: Object.freeze(["approved_for_processing"]),
	approved_for_processing: Object.freeze(["sent_to_migration", "under_review"]),
	sent_to_migration: Object.freeze(["migration_approved", "approved_for_processing"]),
	migration_approved: Object.freeze(["completed", "sent_to_migration"]),
	completed: Object.freeze(["migration_approved"])
});
/**
* Evaluates one staff application status transition against the allowed workflow and its guards.
* @param {string} currentStatus Persisted application status.
* @param {string} targetStatus Requested next status.
* @param {{hasResubmissionRequiredDocuments?: boolean, allRequiredDocumentsApproved?: boolean}} [guards] Server-derived readiness facts.
* @returns {{allowed: boolean, code: string|null}} Safe transition result.
*/
function evaluateApplicationTransition(currentStatus, targetStatus, guards = {}) {
	if (!STATUS_TRANSITIONS[currentStatus]?.includes(targetStatus)) return {
		allowed: false,
		code: "INVALID_APPLICATION_TRANSITION"
	};
	if (currentStatus === "resubmission_required" && guards.hasResubmissionRequiredDocuments) return {
		allowed: false,
		code: "RESUBMISSION_DOCUMENTS_REMAIN"
	};
	if (targetStatus === "approved_for_processing" && !guards.allRequiredDocumentsApproved) return {
		allowed: false,
		code: "APPLICATION_NOT_READY_FOR_APPROVAL"
	};
	return {
		allowed: true,
		code: null
	};
}
/**
* Lists the direct state-machine targets for a persisted application status.
* @param {string} currentStatus Persisted application status.
* @returns {string[]} Allowed direct targets before workflow guards.
*/
function listApplicationStatusTransitions(currentStatus) {
	return [...STATUS_TRANSITIONS[currentStatus] || []];
}
//#endregion
//#region src/server/routes/staffApplicationRoutes.js
var STAFF_ROLES$2 = Object.freeze(["reviewer", "admin"]);
var APPLICATION_STATUS_FILTERS = Object.freeze({
	all: null,
	new: Object.freeze(["submitted"]),
	under_review: Object.freeze(["under_review"]),
	resubmission_required: Object.freeze(["resubmission_required"]),
	approved: Object.freeze(["approved_for_processing"]),
	migration: Object.freeze(["sent_to_migration", "migration_approved"]),
	completed: Object.freeze(["completed"]),
	terminal: Object.freeze([
		"completed",
		"cancelled",
		"rejected"
	]),
	cancelled: Object.freeze(["cancelled"]),
	rejected: Object.freeze(["rejected"]),
	archive_all: Object.freeze([
		"completed",
		"cancelled",
		"rejected"
	]),
	deleted: Object.freeze([])
});
var MAX_PAGE_SIZE = 100;
var MAX_SEARCH_LENGTH = 120;
var READABLE_REVISION_STATUSES = /* @__PURE__ */ new Set([
	"submitted",
	"approved",
	"resubmission_required"
]);
function readSearchTerm(value) {
	if (value === void 0) return "";
	if (typeof value !== "string") throw new ApiError(400, "VALIDATION_ERROR", "Arama metnini kontrol edip tekrar deneyin.");
	const searchTerm = value.trim();
	if (searchTerm.length > MAX_SEARCH_LENGTH) throw new ApiError(400, "VALIDATION_ERROR", "Arama metnini kontrol edip tekrar deneyin.");
	return searchTerm;
}
function readPageNumber(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
	if (value === void 0) return fallback;
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new ApiError(400, "VALIDATION_ERROR", "Sayfalama bilgilerini kontrol edip tekrar deneyin.");
	return value;
}
function escapeLikeTerm(value) {
	return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
function readApplicationQuery(body) {
	const allowedKeys = /* @__PURE__ */ new Set([
		"q",
		"status",
		"page",
		"page_size"
	]);
	if (Object.keys(body).some((key) => !allowedKeys.has(key))) throw new ApiError(400, "VALIDATION_ERROR", "Arama ve filtre bilgilerini kontrol edip tekrar deneyin.");
	const statusFilter = body.status ?? "all";
	if (typeof statusFilter !== "string" || !Object.hasOwn(APPLICATION_STATUS_FILTERS, statusFilter)) throw new ApiError(400, "VALIDATION_ERROR", "Başvuru durumu filtresini kontrol edip tekrar deneyin.");
	const pageSize = readPageNumber(body.page_size, 25, MAX_PAGE_SIZE);
	const maximumPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize);
	return {
		searchTerm: readSearchTerm(body.q),
		statuses: APPLICATION_STATUS_FILTERS[statusFilter],
		isDeleted: statusFilter === "deleted",
		includeDeleted: statusFilter === "archive_all",
		page: readPageNumber(body.page, 1, maximumPage),
		pageSize
	};
}
function createQueueItemDto(application) {
	return {
		id: application.id,
		student_number: application.student_number,
		first_name: application.first_name,
		last_name: application.last_name,
		application_type: application.application_type,
		status: application.status,
		submitted_at: application.submitted_at,
		updated_at: application.updated_at,
		deletion_state: application.deletion_state ?? null
	};
}
function createApplicationDetailDto(application) {
	return {
		id: application.id,
		reference_number: application.reference_number ?? null,
		student_number: application.student_number,
		status: application.status,
		application_type: application.application_type,
		created_at: application.created_at,
		updated_at: application.updated_at,
		submitted_at: application.submitted_at,
		first_name: application.first_name,
		last_name: application.last_name,
		email: application.student_email,
		phone: application.student_phone,
		passport_number: application.passport_number,
		nationality: application.nationality,
		date_of_birth: application.date_of_birth,
		is_under_18: application.is_under_18 === null ? null : application.is_under_18 === 1,
		address_evidence_type: application.address_evidence_type ?? null,
		fingerprint_status: application.fingerprint_status ?? null,
		fingerprint_code: application.fingerprint_code ?? null,
		declaration_version: application.declaration_version ?? null,
		declaration_accepted_at: application.declaration_accepted_at ?? null,
		contact_acknowledgement_accepted_current: application.contact_acknowledgement_accepted_current === 1,
		contact_acknowledgement_accepted_at: application.contact_acknowledgement_accepted_at ?? null
	};
}
function readSafeFilename(filename) {
	if (typeof filename !== "string") return null;
	const safeFilename = filename.replace(/[\\/\u0000-\u001F\u007F]/g, "").trim();
	return safeFilename ? safeFilename.slice(0, 255) : null;
}
function createDocumentDetailDtos(application, storedRequirements) {
	const requirementsByCode = new Map(storedRequirements.map((requirement) => [requirement.code, requirement]));
	return listDocumentPolicies(application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null).map((policy) => {
		const requirement = requirementsByCode.get(policy.code) || {};
		const hasFinalizedCurrentDocument = READABLE_REVISION_STATUSES.has(requirement.revision_status) && requirement.upload_status === "finalized" && requirement.current_cleanup_status === "none" && requirement.upload_intent_status === "completed" && policy.accepted_media_types.includes(requirement.media_type);
		const hasSafeCurrentDocument = hasFinalizedCurrentDocument && requirement.scan_status === "clean";
		return {
			code: policy.code,
			label_key: policy.label_key,
			required: policy.required,
			access_available: hasSafeCurrentDocument,
			can_approve: hasSafeCurrentDocument && requirement.revision_status === "submitted" && ["pending", "under_review"].includes(requirement.review_status) && ["under_review", "resubmission_required"].includes(application.status),
			can_unapprove: hasSafeCurrentDocument && requirement.revision_status === "approved" && requirement.review_status === "approved" && ["under_review", "resubmission_required"].includes(application.status),
			can_request_resubmission: hasFinalizedCurrentDocument && [
				"clean",
				"unsafe",
				"failed"
			].includes(requirement.scan_status) && requirement.revision_status === "submitted" && ["pending", "under_review"].includes(requirement.review_status) && ["under_review", "resubmission_required"].includes(application.status),
			revision_number: requirement.revision_number ?? null,
			review_status: requirement.review_status ?? null,
			revision_status: requirement.revision_status ?? null,
			upload_status: requirement.upload_status ?? null,
			scan_status: requirement.scan_status ?? null,
			cleanup_status: requirement.cleanup_status ?? null,
			filename: readSafeFilename(requirement.original_filename),
			...requirement.scan_status === "pending" && typeof requirement.file_id === "string" ? { file_id: requirement.file_id } : {},
			...typeof requirement.student_message === "string" ? { student_message: requirement.student_message } : {}
		};
	});
}
function readAllowedStatusTransitions(application, requirements) {
	const requirementsByCode = new Map(requirements.map((requirement) => [requirement.code, requirement]));
	const applicableRequirements = listDocumentPolicies(application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null).map((policy) => ({
		...requirementsByCode.get(policy.code),
		is_required: policy.required ? 1 : 0
	}));
	const hasResubmissionRequiredDocuments = applicableRequirements.some((requirement) => requirement.review_status === "resubmission_required" || requirement.revision_status === "resubmission_required");
	const allRequiredDocumentsApproved = applicableRequirements.filter((requirement) => requirement.is_required === 1).every((requirement) => requirement.review_status === "approved" && requirement.revision_status === "approved" && requirement.upload_status === "finalized" && requirement.scan_status === "clean" && requirement.current_cleanup_status === "none" && requirement.upload_intent_status === "completed");
	return listApplicationStatusTransitions(application.status).filter((targetStatus) => evaluateApplicationTransition(application.status, targetStatus, {
		hasResubmissionRequiredDocuments,
		allRequiredDocumentsApproved
	}).allowed);
}
/**
* Returns one staff-filtered, paginated page of non-draft applications.
* @param {Request} request Same-origin POST request from an authenticated staff member.
* @param {object} environment Worker bindings containing D1.
* @returns {Promise<object>} Staff-safe queue items and pagination metadata.
* @throws {ApiError} When method, origin, session, role, or query data is invalid.
*/
async function queryStaffApplications(request, environment) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	await requireStaff(request, environment, STAFF_ROLES$2);
	const query = readApplicationQuery(await readJsonBody(request));
	const offset = (query.page - 1) * query.pageSize;
	const result = await createD1Repositories(environment.DB).applications.queryStaffApplications({
		statuses: query.statuses,
		isDeleted: query.isDeleted,
		includeDeleted: query.includeDeleted,
		searchPattern: query.searchTerm ? escapeLikeTerm(query.searchTerm) : null,
		pageSize: query.pageSize,
		offset
	});
	return {
		items: result.items.map(createQueueItemDto),
		pagination: {
			page: query.page,
			page_size: query.pageSize,
			total_items: result.totalItems,
			total_pages: result.totalItems === 0 ? 0 : Math.ceil(result.totalItems / query.pageSize)
		}
	};
}
/**
* Returns one non-draft application detail and its current policy-based document metadata.
* @param {Request} request Authenticated staff GET request.
* @param {object} environment Worker bindings containing D1.
* @param {string} applicationId Exact application identifier from the route.
* @returns {Promise<object>} Explicit staff detail DTO with no storage or session capabilities.
* @throws {ApiError} When method, staff session, or application visibility is invalid.
*/
async function readStaffApplicationDetail(request, environment, applicationId) {
	requireMethod(request, "GET");
	await requireStaff(request, environment, STAFF_ROLES$2);
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(applicationId);
	if (!application || application.status === "draft") throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	if ((await environment.DB.prepare(`SELECT state FROM application_deletions WHERE application_id=?`).bind(applicationId).first())?.state === "purge_pending") throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	const [storedRequirements, studentMessages] = await Promise.all([repositories.documents.listStudentRequirements(application.id), repositories.applicationNotes.listLatestStudentDocumentMessages(application.id)]);
	const requirementsWithMessages = storedRequirements.map((requirement) => ({
		...requirement,
		student_message: studentMessages.get(requirement.document_record_id)
	}));
	return {
		application: createApplicationDetailDto(application),
		allowed_status_transitions: readAllowedStatusTransitions(application, storedRequirements),
		documents: createDocumentDetailDtos(application, requirementsWithMessages)
	};
}
//#endregion
//#region src/server/routes/staffReviewRoutes.js
var STAFF_ROLES$1 = Object.freeze(["reviewer", "admin"]);
function requireOnlyKeys$1(body, allowedKeys) {
	if (Object.keys(body).some((key) => !allowedKeys.includes(key))) throw new ApiError(400, "VALIDATION_ERROR", "İşlem bilgilerini kontrol edip tekrar deneyin.");
}
function readExpectedRevisionNumber(value) {
	if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, "VALIDATION_ERROR", "Belge revizyonunu kontrol edip tekrar deneyin.");
	return value;
}
function readResubmissionReason(value) {
	if (typeof value !== "string") throw new ApiError(400, "VALIDATION_ERROR", "Açıklama alanını kontrol edip tekrar deneyin.");
	const reason = value.trim();
	const length = [...reason].length;
	if ([...reason.replace(/[\s\p{C}]/gu, "")].length < 3 || length > 1e3) throw new ApiError(400, "VALIDATION_ERROR", "Açıklama 3 ile 1000 karakter arasında olmalıdır.");
	return reason;
}
function requireApplication(application) {
	if (!application || application.status === "draft") throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
}
async function resolveReviewTarget(repositories, applicationId, code, expectedRevisionNumber) {
	const application = await repositories.applications.findById(applicationId);
	requireApplication(application);
	if (!readDocumentPolicy(code, application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null)) throw new ApiError(404, "DOCUMENT_NOT_AVAILABLE", "Belge mevcut değil veya incelemeye uygun değil.");
	const document = await repositories.documents.findCurrentPrivateFileByApplicationAndCode(applicationId, code);
	if (!document) throw new ApiError(409, "DOCUMENT_NOT_REVIEWABLE", "Belge güncel ve güvenli incelemeye uygun değil.");
	if (document.revision_number !== expectedRevisionNumber || document.revision_status !== "submitted") throw new ApiError(409, "DOCUMENT_REVIEW_CONFLICT", "Belge başka bir işlem nedeniyle değişti. Güncel durumu yeniden yükleyin.");
	if (!["pending", "under_review"].includes(document.review_status) || !["under_review", "resubmission_required"].includes(application.status) || document.upload_status !== "finalized" || document.upload_intent_status !== "completed" || document.scan_status !== "clean" || document.cleanup_status !== "none") throw new ApiError(409, "DOCUMENT_NOT_REVIEWABLE", "Belge güncel ve güvenli incelemeye uygun değil.");
	if (!readDocumentPolicy(code, application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null).accepted_media_types.includes(document.media_type)) throw new ApiError(409, "DOCUMENT_NOT_REVIEWABLE", "Belge güncel ve güvenli incelemeye uygun değil.");
	return {
		application,
		document
	};
}
function reviewConflict() {
	return new ApiError(409, "DOCUMENT_REVIEW_CONFLICT", "Belge başka bir işlem nedeniyle değişti. Güncel durumu yeniden yükleyin.");
}
async function resolveResubmissionTarget({ repositories, applicationId, code, revisionNumber }) {
	const application = await repositories.applications.findById(applicationId);
	requireApplication(application);
	const policy = readDocumentPolicy(code, application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null);
	if (!policy) throw new ApiError(404, "DOCUMENT_NOT_AVAILABLE", "Belge mevcut değil veya yenilemeye uygun değil.");
	const document = await repositories.applicationReviews.findCurrentDocumentForResubmission(applicationId, code);
	if (!document) throw new ApiError(409, "DOCUMENT_NOT_REVIEWABLE", "Belge güncel ve yenilemeye uygun değil.");
	if (document.revision_number !== revisionNumber || document.revision_status !== "submitted") throw reviewConflict();
	if (!["pending", "under_review"].includes(document.review_status) || !policy.accepted_media_types.includes(document.media_type)) throw new ApiError(409, "DOCUMENT_NOT_REVIEWABLE", "Belge güncel ve yenilemeye uygun değil.");
	return document;
}
/**
* Approves a safe, current application document revision for an authenticated reviewer.
* @param {{request: Request, environment: object, applicationId: string, code: string, requestId: string}} input Staff route context.
* @returns {Promise<object>} Safe mutation result.
*/
async function approveStaffApplicationDocument({ request, environment, applicationId, code, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const staff = await requireStaff(request, environment, STAFF_ROLES$1);
	const body = await readJsonBody(request);
	requireOnlyKeys$1(body, ["expected_revision_number"]);
	const revisionNumber = readExpectedRevisionNumber(body.expected_revision_number);
	const repositories = createD1Repositories(environment.DB);
	const { document } = await resolveReviewTarget(repositories, applicationId, code, revisionNumber);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	if (!await repositories.applicationReviews.approveCurrentDocument({
		applicationId,
		documentRecordId: document.document_record_id,
		revisionId: document.revision_id,
		revisionNumber,
		code,
		staffId: staff.id,
		now,
		requestId,
		auditId: crypto.randomUUID()
	})) throw reviewConflict();
	return {
		document_status: "approved",
		revision_number: revisionNumber
	};
}
/** Reopens an approved current document for review while retaining its clean scan verdict. */
async function unapproveStaffApplicationDocument({ request, environment, applicationId, code, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const staff = await requireStaff(request, environment, STAFF_ROLES$1);
	const body = await readJsonBody(request);
	requireOnlyKeys$1(body, ["expected_revision_number"]);
	const revisionNumber = readExpectedRevisionNumber(body.expected_revision_number);
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(applicationId);
	requireApplication(application);
	if (!readDocumentPolicy(code, application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null)) throw new ApiError(404, "DOCUMENT_NOT_AVAILABLE", "Belge mevcut değil veya incelemeye uygun değil.");
	const document = await repositories.documents.findCurrentPrivateFileByApplicationAndCode(applicationId, code);
	if (!document || document.revision_number !== revisionNumber || document.revision_status !== "approved" || document.review_status !== "approved" || !["under_review", "resubmission_required"].includes(application.status) || document.upload_status !== "finalized" || document.upload_intent_status !== "completed" || document.scan_status !== "clean" || document.cleanup_status !== "none") throw reviewConflict();
	if (!await repositories.applicationReviews.unapproveCurrentDocument({
		applicationId,
		documentRecordId: document.document_record_id,
		revisionId: document.revision_id,
		revisionNumber,
		code,
		staffId: staff.id,
		now: (/* @__PURE__ */ new Date()).toISOString(),
		requestId,
		auditId: crypto.randomUUID()
	})) throw reviewConflict();
	return {
		document_status: "under_review",
		revision_number: revisionNumber
	};
}
/**
* Requests replacement of a finalized current document without opening it; stores the reason atomically.
* @param {{request: Request, environment: object, applicationId: string, code: string, requestId: string}} input Staff route context.
* @returns {Promise<object>} Safe mutation result.
*/
async function requestStaffDocumentResubmission({ request, environment, applicationId, code, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const staff = await requireStaff(request, environment, STAFF_ROLES$1);
	const body = await readJsonBody(request);
	requireOnlyKeys$1(body, ["expected_revision_number", "reason"]);
	const revisionNumber = readExpectedRevisionNumber(body.expected_revision_number);
	const reason = readResubmissionReason(body.reason);
	const repositories = createD1Repositories(environment.DB);
	const document = await resolveResubmissionTarget({
		repositories,
		applicationId,
		code,
		revisionNumber
	});
	const now = (/* @__PURE__ */ new Date()).toISOString();
	if (!await repositories.applicationReviews.requestCurrentDocumentResubmission({
		applicationId,
		documentRecordId: document.document_record_id,
		revisionId: document.revision_id,
		revisionNumber,
		expectedScanStatus: document.scan_status,
		code,
		staffId: staff.id,
		reason,
		now,
		requestId,
		auditId: crypto.randomUUID(),
		noteId: crypto.randomUUID()
	})) throw reviewConflict();
	return {
		application_status: "resubmission_required",
		document_status: "resubmission_required",
		revision_number: revisionNumber
	};
}
/**
* Applies one guarded staff status transition to a non-draft application.
* @param {{request: Request, environment: object, applicationId: string, requestId: string}} input Staff route context.
* @returns {Promise<object>} Safe status result.
*/
async function transitionStaffApplicationStatus({ request, environment, applicationId, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const staff = await requireStaff(request, environment, STAFF_ROLES$1);
	const body = await readJsonBody(request);
	requireOnlyKeys$1(body, ["target_status", "expected_updated_at"]);
	if (typeof body.target_status !== "string" || typeof body.expected_updated_at !== "string" || !body.expected_updated_at.trim() || body.expected_updated_at.length > 64) throw new ApiError(400, "VALIDATION_ERROR", "Başvuru durumu ve sürümü kontrol edip tekrar deneyin.");
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.applications.findById(applicationId);
	requireApplication(application);
	if (application.updated_at !== body.expected_updated_at) throw new ApiError(409, "APPLICATION_STATE_CONFLICT", "Başvuru başka bir işlem nedeniyle değişti. Güncel durumu yeniden yükleyin.");
	const storedRequirements = await repositories.documents.listStudentRequirements(applicationId);
	const requirementsByCode = new Map(storedRequirements.map((requirement) => [requirement.code, requirement]));
	const requirements = listDocumentPolicies(application.application_type, application.is_under_18 === 1, application.address_evidence_type ?? null).map((policy) => ({
		...requirementsByCode.get(policy.code),
		is_required: policy.required ? 1 : 0
	}));
	const transition = evaluateApplicationTransition(application.status, body.target_status, {
		hasResubmissionRequiredDocuments: requirements.some((requirement) => requirement.review_status === "resubmission_required" || requirement.revision_status === "resubmission_required"),
		allRequiredDocumentsApproved: requirements.filter((requirement) => requirement.is_required === 1).every((requirement) => requirement.review_status === "approved" && requirement.revision_status === "approved" && requirement.upload_status === "finalized" && requirement.scan_status === "clean" && requirement.current_cleanup_status === "none" && requirement.upload_intent_status === "completed")
	});
	if (!transition.allowed) {
		const code = transition.code === "APPLICATION_NOT_READY_FOR_APPROVAL" ? transition.code : transition.code === "RESUBMISSION_DOCUMENTS_REMAIN" ? "APPLICATION_NOT_READY_FOR_REVIEW" : "INVALID_APPLICATION_TRANSITION";
		throw new ApiError(409, code, code === "APPLICATION_NOT_READY_FOR_APPROVAL" ? "İşlem onayı için tüm zorunlu belgeler onaylanmış olmalıdır." : code === "APPLICATION_NOT_READY_FOR_REVIEW" ? "Yeniden yükleme bekleyen belgeler tamamlanmadan inceleme sürdürülemez." : "Bu başvuru durum geçişine izin verilmiyor.");
	}
	const now = (/* @__PURE__ */ new Date()).toISOString();
	if (!await repositories.applicationReviews.transitionApplicationStatus({
		applicationId,
		currentStatus: application.status,
		expectedUpdatedAt: body.expected_updated_at,
		targetStatus: body.target_status,
		staffId: staff.id,
		now,
		requestId,
		auditId: crypto.randomUUID()
	})) throw new ApiError(409, "APPLICATION_STATE_CONFLICT", "Başvuru başka bir işlem nedeniyle değişti. Güncel durumu yeniden yükleyin.");
	return {
		application_status: body.target_status,
		updated_at: now
	};
}
//#endregion
//#region src/server/routes/ocrRoute.js
var MAX_OCR_IMAGE_BYTES = 15e6;
var MAX_JSON_BYTES = Math.ceil(MAX_OCR_IMAGE_BYTES * 4 / 3) + 4096;
function decodeBase64Image(encodedImage) {
	if (typeof encodedImage !== "string" || encodedImage.length > MAX_JSON_BYTES) throw new ApiError(400, "VALIDATION_ERROR", "Belge görüntüsü gerekli.");
	const base64 = encodedImage.includes(",") ? encodedImage.slice(encodedImage.indexOf(",") + 1) : encodedImage;
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new ApiError(400, "VALIDATION_ERROR", "Belge görüntüsü okunamadı.");
	const binary = atob(base64);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function readImageBody(request) {
	if ((request.headers.get("Content-Type") || "").startsWith("application/json")) return decodeBase64Image((await readJsonBody(request, MAX_JSON_BYTES)).imageContent);
	if (Number(request.headers.get("Content-Length") || 0) > MAX_OCR_IMAGE_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "Belge görüntüsü boyut sınırını aşıyor.");
	const imageBytes = new Uint8Array(await request.arrayBuffer());
	if (imageBytes.length > MAX_OCR_IMAGE_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "Belge görüntüsü boyut sınırını aşıyor.");
	return imageBytes;
}
function mapAzureResult(payload) {
	const annotations = [{ description: "" }];
	const lines = [];
	for (const block of payload.readResult?.blocks || []) for (const line of block.lines || []) {
		lines.push(line.text);
		for (const word of line.words || []) annotations.push({
			description: word.text,
			boundingPoly: { vertices: word.boundingPolygon || [] }
		});
	}
	annotations[0].description = lines.join("\n");
	return { responses: [{ textAnnotations: annotations }] };
}
async function readAzure(imageBytes, environment) {
	if (!environment.AZURE_VISION_KEY || !environment.AZURE_VISION_ENDPOINT) return null;
	let endpoint;
	try {
		endpoint = new URL(environment.AZURE_VISION_ENDPOINT);
	} catch {
		return null;
	}
	if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return null;
	endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/computervision/imageanalysis:analyze`;
	endpoint.search = "?features=read&api-version=2023-10-01";
	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": environment.AZURE_VISION_KEY,
				"Content-Type": "application/octet-stream"
			},
			body: imageBytes,
			signal: AbortSignal.timeout(2e4)
		});
		if (!response.ok) return null;
		return mapAzureResult(await response.json());
	} catch {
		return null;
	}
}
async function readGoogle(imageBytes, apiKey) {
	if (!apiKey) throw new ApiError(503, "OCR_UNAVAILABLE", "Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.", true);
	let binary = "";
	for (let offset = 0; offset < imageBytes.length; offset += 32768) binary += String.fromCharCode(...imageBytes.subarray(offset, offset + 32768));
	const imageContent = btoa(binary);
	let response;
	try {
		response = await fetch(`https://eu-vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ requests: [{
				image: { content: imageContent },
				features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
				imageContext: { languageHints: ["tr", "en"] }
			}] }),
			signal: AbortSignal.timeout(2e4)
		});
	} catch {
		throw new ApiError(502, "OCR_PROVIDER_FAILURE", "Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.", true);
	}
	if (!response.ok) throw new ApiError(502, "OCR_PROVIDER_FAILURE", "Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.", true);
	try {
		return await response.json();
	} catch {
		throw new ApiError(502, "OCR_PROVIDER_FAILURE", "Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.", true);
	}
}
/**
* Authenticates and forwards one bounded image to the configured OCR provider.
* @param {Request} request Fetch API request.
* @param {object} environment Worker bindings with provider credentials.
* @returns {Promise<object>} OCR response compatible with the existing staff client.
* @throws {ApiError} When authorization, input, or provider checks fail.
*/
async function recognizeDocument(request, environment) {
	requireMethod(request, "POST");
	await requireStaff(request, environment);
	requireSameOrigin(request);
	const imageBytes = await readImageBody(request);
	if (imageBytes.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "Belge görüntüsü boş.");
	if (imageBytes.length > MAX_OCR_IMAGE_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "Belge görüntüsü boyut sınırını aşıyor.");
	const azureResult = await readAzure(imageBytes, environment);
	if (azureResult) return azureResult;
	return readGoogle(imageBytes, environment.GOOGLE_VISION_API_KEY);
}
//#endregion
//#region src/server/auth/passwordHash.js
var PASSWORD_HASH_SCHEME = "pbkdf2_sha256";
var PASSWORD_HASH_ITERATIONS = 1e5;
var PASSWORD_SALT_BYTES = 16;
var PASSWORD_KEY_BYTES = 32;
var MAX_PASSWORD_BYTES = 1024;
var DUMMY_PASSWORD_HASH = `pbkdf2_sha256$${PASSWORD_HASH_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
var encoder = new TextEncoder();
function encodeBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decodeBase64Url(value) {
	const base64Value = value.replaceAll("-", "+").replaceAll("_", "/");
	const paddedValue = base64Value.padEnd(Math.ceil(base64Value.length / 4) * 4, "=");
	return Uint8Array.from(atob(paddedValue), (character) => character.charCodeAt(0));
}
async function deriveKey(password, salt, iterations) {
	const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
	const keyBits = await crypto.subtle.deriveBits({
		name: "PBKDF2",
		hash: "SHA-256",
		salt,
		iterations
	}, passwordKey, 256);
	return new Uint8Array(keyBits);
}
function isValidPassword(password) {
	if (typeof password !== "string") return false;
	const passwordBytes = encoder.encode(password);
	return password.length >= 12 && passwordBytes.length <= MAX_PASSWORD_BYTES;
}
function haveEqualBytes(first, second) {
	if (first.length !== second.length) return false;
	let difference = 0;
	for (let index = 0; index < first.length; index += 1) difference |= first[index] ^ second[index];
	return difference === 0;
}
/**
* Derives a salted PBKDF2-HMAC-SHA-256 staff password hash for Workers Web Crypto.
* @param {string} password Plaintext input held only for this request.
* @returns {Promise<string>} Versioned password hash suitable for D1 storage.
* @throws {TypeError} When the password is shorter than 12 characters or exceeds 1024 UTF-8 bytes.
*/
async function deriveStaffPasswordHash(password) {
	if (!isValidPassword(password)) throw new TypeError("Staff password must be at least 12 characters and at most 1024 UTF-8 bytes.");
	const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
	const key = await deriveKey(password, salt, PASSWORD_HASH_ITERATIONS);
	return `${PASSWORD_HASH_SCHEME}$${PASSWORD_HASH_ITERATIONS}$${encodeBase64Url(salt)}$${encodeBase64Url(key)}`;
}
/**
* Verifies a password using the parameters encoded in a stored staff password hash.
* @param {string} password Candidate plaintext password.
* @param {string} passwordHash Versioned D1 password hash.
* @returns {Promise<boolean>} Whether the supplied password matches the stored hash.
*/
async function verifyStaffPassword(password, passwordHash) {
	if (typeof password !== "string" || encoder.encode(password).length > MAX_PASSWORD_BYTES) return false;
	const [scheme, iterationText, saltText, keyText, ...extra] = (typeof passwordHash === "string" ? passwordHash : DUMMY_PASSWORD_HASH).split("$");
	const iterations = Number(iterationText);
	if (extra.length || scheme !== PASSWORD_HASH_SCHEME || !Number.isSafeInteger(iterations) || iterations < PASSWORD_HASH_ITERATIONS || iterations > 1e6) {
		await deriveKey(password, new Uint8Array(PASSWORD_SALT_BYTES), PASSWORD_HASH_ITERATIONS);
		return false;
	}
	try {
		const salt = decodeBase64Url(saltText);
		const expectedKey = decodeBase64Url(keyText);
		if (salt.length !== PASSWORD_SALT_BYTES || expectedKey.length !== PASSWORD_KEY_BYTES) return false;
		return haveEqualBytes(await deriveKey(password, salt, iterations), expectedKey);
	} catch {
		return false;
	}
}
//#endregion
//#region src/server/routes/staffRoutes.js
var STAFF_SESSION_SECONDS = 43200;
var REMEMBERED_SESSION_SECONDS = 2592e3;
var LOGIN_WINDOW_SECONDS = 900;
var MAX_LOGIN_ATTEMPTS = 5;
async function hashLoginIdentity(request, normalizedUsername) {
	const address = request.headers.get("CF-Connecting-IP") || "unknown-client";
	const value = new TextEncoder().encode(`${address}\u0000${normalizedUsername}`);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function publicStaff(staff) {
	return {
		id: staff.id,
		username: staff.username,
		displayName: staff.display_name,
		role: staff.role
	};
}
function validatePassword(password) {
	if (typeof password !== "string" || password.length < 12 || new TextEncoder().encode(password).length > 1024) throw new ApiError(400, "VALIDATION_ERROR", "Şifre en az 12 karakter olmalı ve izin verilen uzunluğu aşmamalıdır.");
	return password;
}
async function findLoginStaff(repositories, username) {
	try {
		return await repositories.staff.findByUsername(username);
	} catch {
		return null;
	}
}
function readLoginInput(body) {
	const username = typeof body.username === "string" ? body.username.trim() : "";
	const password = typeof body.password === "string" ? body.password : "";
	if (username.length > 64 || password.length === 0 || password.length > 1024) throw new ApiError(401, "INVALID_CREDENTIALS", "Kullanıcı adı veya şifre hatalı. Bilgilerinizi kontrol edip tekrar deneyin.");
	return {
		username,
		password,
		rememberMe: body.rememberMe === true
	};
}
async function authenticateStaff(repositories, request, { username, password }, sharedUsername) {
	const isSharedAccount = isConfiguredUsername(username, sharedUsername);
	const staff = isSharedAccount ? await findLoginStaff(repositories, username) : null;
	const loginKey = await hashLoginIdentity(request, staff?.normalized_username || username.toLocaleLowerCase("en-US"));
	const nowSeconds = Math.floor(Date.now() / 1e3);
	if (await repositories.sessions.isLoginBlocked(loginKey, nowSeconds)) throw new ApiError(429, "RATE_LIMITED", "Çok fazla başarısız giriş denemesi yapıldı. Bir süre sonra tekrar deneyin.", true);
	const passwordMatches = await verifyStaffPassword(password, staff?.password_hash);
	if (!isSharedAccount || !staff || !staff.is_active || !passwordMatches) {
		await repositories.sessions.recordFailedLogin(loginKey, nowSeconds, {
			maxAttempts: MAX_LOGIN_ATTEMPTS,
			windowSeconds: LOGIN_WINDOW_SECONDS
		});
		throw new ApiError(401, "INVALID_CREDENTIALS", "Kullanıcı adı veya şifre hatalı. Bilgilerinizi kontrol edip tekrar deneyin.");
	}
	return {
		staff,
		loginKey
	};
}
function isConfiguredUsername(username, sharedUsername) {
	try {
		return normalizeUsername(username) === sharedUsername;
	} catch {
		return false;
	}
}
async function createStaffLoginSession(repositories, staff, requestId, maxAge) {
	const token = createOpaqueSessionToken();
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	await repositories.sessions.createStaffSession({
		id: crypto.randomUUID(),
		staffUserId: staff.id,
		tokenHash: await hashSessionToken(token),
		expiresAt: new Date(Date.now() + maxAge * 1e3).toISOString(),
		createdAt
	});
	await repositories.staff.updateLastLogin(staff.id, createdAt);
	await createAuditEvent(repositories, {
		eventType: "staff.login",
		actorType: "staff",
		actorStaffId: staff.id,
		requestId,
		metadata: {
			role: staff.role,
			result: "success"
		}
	});
	return token;
}
/**
* Authenticates one D1-backed staff account and creates its secure session cookie.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation ID for the audit event.
* @returns {Promise<object>} Route result with the safe staff profile and cookie.
* @throws {ApiError} When validation, origin, credentials, or rate checks fail.
*/
async function loginStaff(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const credentials = readLoginInput(await readJsonBody(request));
	const sharedUsername = readSharedStaffUsername(environment);
	const repositories = createRepositories(environment);
	const { staff, loginKey } = await authenticateStaff(repositories, request, credentials, sharedUsername);
	await repositories.sessions.clearLoginAttempts(loginKey);
	const maxAge = credentials.rememberMe ? REMEMBERED_SESSION_SECONDS : STAFF_SESSION_SECONDS;
	const token = await createStaffLoginSession(repositories, staff, requestId, maxAge);
	return routeResult({
		success: true,
		authenticated: true,
		staff: publicStaff(staff)
	}, { cookie: createSessionCookie("staff", token, maxAge) });
}
/**
* Returns the current D1-backed staff identity.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Safe authenticated staff profile.
* @throws {ApiError} When the request method or session is invalid.
*/
async function readStaffSession(request, environment) {
	requireMethod(request, "GET");
	return {
		authenticated: true,
		staff: await requireStaff(request, environment)
	};
}
/**
* Revokes the current staff session and expires its browser cookie.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @returns {Promise<object>} Route result with an expired session cookie.
* @throws {ApiError} When the request method or origin is invalid.
*/
async function logoutStaff(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const token = readCookie(request, getSessionCookieName("staff"));
	if (token && environment.DB) {
		const repositories = createD1Repositories(environment.DB);
		const revokedAt = (/* @__PURE__ */ new Date()).toISOString();
		await repositories.sessions.revokeStaffSessionWithAudit({
			tokenHash: await hashSessionToken(token),
			revokedAt,
			idleCutoff: (/* @__PURE__ */ new Date(Date.now() - STAFF_IDLE_TIMEOUT_SECONDS * 1e3)).toISOString(),
			auditEventId: crypto.randomUUID(),
			requestId
		});
	}
	return routeResult({ success: true }, { cookie: createExpiredSessionCookie("staff") });
}
/**
* Creates the first administrator through the one-time bootstrap token.
* @param {Request} request Worker request.
* @param {object} environment Worker bindings.
* @param {string} requestId Correlation ID for the audit event.
* @returns {Promise<object>} Route result containing the safe administrator profile.
* @throws {ApiError} When bootstrap is unauthorized, closed, or invalid.
*/
async function bootstrapStaff(request, environment, requestId) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const sharedUsername = readSharedStaffUsername(environment);
	if (!environment.STAFF_BOOTSTRAP_TOKEN || !constantTimeEqual(request.headers.get("X-Staff-Bootstrap-Token") || "", environment.STAFF_BOOTSTRAP_TOKEN)) throw new ApiError(403, "BOOTSTRAP_TOKEN_REQUIRED", "İlk yetkili hesabı için geçerli kurulum anahtarı gerekli.");
	const repositories = createRepositories(environment);
	if (await repositories.staff.hasBootstrapAdmin()) throw new ApiError(409, "BOOTSTRAP_CLOSED", "İlk yetkili hesabı daha önce oluşturuldu.");
	const body = await readJsonBody(request);
	const username = readUsername(body.username);
	if (!isConfiguredUsername(username, sharedUsername)) throw new ApiError(400, "VALIDATION_ERROR", "Kurulum kullanıcı adı yapılandırılmış ortak hesapla eşleşmelidir.");
	const passwordHash = await deriveStaffPasswordHash(validatePassword(body.password));
	const displayName = requireText(body.display_name, {
		field: "Görünen ad",
		minLength: 1,
		maxLength: 120
	});
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	try {
		const staff = await repositories.staff.createFirstAdmin({
			id: crypto.randomUUID(),
			username,
			passwordHash,
			displayName,
			createdAt,
			requestId
		});
		if (!staff) throw new ApiError(409, "BOOTSTRAP_CLOSED", "İlk yetkili hesabı daha önce oluşturuldu.");
		return routeResult({ user: publicStaff(staff) }, { status: 201 });
	} catch (error) {
		if (await repositories.staff.hasBootstrapAdmin()) throw new ApiError(409, "BOOTSTRAP_CLOSED", "İlk yetkili hesabı daha önce oluşturuldu.");
		if (/unique constraint/i.test(String(error?.message))) throw new ApiError(409, "USERNAME_UNAVAILABLE", "Bu kullanıcı adı kullanılamıyor.");
		throw error;
	}
}
function constantTimeEqual(first, second) {
	const left = new TextEncoder().encode(first);
	const right = new TextEncoder().encode(second);
	let difference = left.length ^ right.length;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) difference |= (left[index] || 0) ^ (right[index] || 0);
	return difference === 0;
}
function readUsername(value) {
	const username = requireText(value, {
		field: "Kullanıcı adı",
		minLength: 3,
		maxLength: 64
	});
	try {
		normalizeUsername(username);
	} catch {
		throw new ApiError(400, "VALIDATION_ERROR", "Kullanıcı adını kontrol edip tekrar deneyin.");
	}
	return username;
}
//#endregion
//#region src/server/services/appsScriptProxy.js
var ALLOWED_ACTIONS = /* @__PURE__ */ new Set([
	"getAll",
	"search",
	"add",
	"update",
	"unmark",
	"remove"
]);
var REQUEST_TIMEOUT_MS = 5e4;
var UpstreamServiceError = class extends Error {
	constructor(code, isConfigurationError = false) {
		super("Tebligat service request failed.");
		this.name = "UpstreamServiceError";
		this.code = code;
		this.isConfigurationError = isConfigurationError;
	}
};
function readEndpoint(environment) {
	if (!environment.APPS_SCRIPT_URL || !environment.APPS_SCRIPT_API_KEY) throw new UpstreamServiceError("MISSING_CONFIGURATION", true);
	let endpoint;
	try {
		endpoint = new URL(environment.APPS_SCRIPT_URL);
	} catch {
		throw new UpstreamServiceError("INVALID_CONFIGURATION", true);
	}
	if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new UpstreamServiceError("INVALID_CONFIGURATION", true);
	return endpoint.toString();
}
/**
* Calls the allowlisted Apps Script API with credentials kept in Worker bindings.
* @param {string} action Approved Apps Script action.
* @param {Record<string, string>} parameters Validated request parameters.
* @param {object} environment Cloudflare Worker bindings.
* @param {typeof fetch} fetcher Fetch implementation used for upstream I/O.
* @returns {Promise<object>} Successful upstream result.
* @throws {UpstreamServiceError} When configuration or upstream response fails.
*/
async function callAppsScript(action, parameters, environment, fetcher = fetch) {
	if (!ALLOWED_ACTIONS.has(action)) throw new UpstreamServiceError("UNSUPPORTED_ACTION", true);
	const endpoint = readEndpoint(environment);
	let response;
	let payload = null;
	let postError = null;
	try {
		response = await fetcher(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...parameters,
				action,
				key: environment.APPS_SCRIPT_API_KEY
			}),
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		if (response.ok) try {
			payload = await response.json();
		} catch {
			payload = null;
		}
		else if (response.status >= 300 && response.status < 400) {
			const rawLocation = response.headers.get("Location") || response.headers.get("location");
			if (rawLocation) {
				const targetUrl = new URL(rawLocation, endpoint).toString();
				try {
					const echoResponse = await fetcher(targetUrl, {
						method: "GET",
						redirect: "follow",
						signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
					});
					if (echoResponse.ok) try {
						payload = await echoResponse.json();
					} catch {
						payload = null;
					}
				} catch {
					payload = null;
				}
			}
			if (!payload && action !== "getAll" && action !== "search") payload = { success: true };
		}
	} catch (error) {
		postError = error;
	}
	if ((!payload || typeof payload !== "object" || Array.isArray(payload) || payload.success === false) && (action === "getAll" || action === "search")) try {
		const getUrl = new URL(endpoint);
		getUrl.searchParams.set("key", environment.APPS_SCRIPT_API_KEY);
		if (action === "search" && parameters.q) {
			getUrl.searchParams.set("q", parameters.q);
			if (parameters.year) getUrl.searchParams.set("year", parameters.year);
		} else {
			getUrl.searchParams.set("action", action);
			for (const [key, value] of Object.entries(parameters)) if (value !== void 0 && value !== null) getUrl.searchParams.set(key, String(value));
		}
		const getResponse = await fetcher(getUrl.toString(), {
			method: "GET",
			redirect: "follow",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		if (getResponse.ok) try {
			payload = await getResponse.json();
		} catch {
			payload = null;
		}
	} catch (error) {
		throw new UpstreamServiceError(error?.name === "TimeoutError" || error?.name === "AbortError" || postError?.name === "TimeoutError" || postError?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FAILURE");
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.success === false && !payload.results) throw new UpstreamServiceError(postError?.name === "TimeoutError" || postError?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FAILURE");
	return payload;
}
//#endregion
//#region src/server/routes/tebligatRoutes.js
var MUTATIONS = Object.freeze({
	"/api/add-tebligat": {
		action: "add",
		requiresNumber: false
	},
	"/api/update-tebligat": {
		action: "update",
		requiresNumber: true
	},
	"/api/unmark-tebligat": {
		action: "unmark",
		requiresNumber: false
	},
	"/api/remove-tebligat": {
		action: "remove",
		requiresNumber: false
	}
});
function safeUpstreamFailure(error) {
	if (!(error instanceof UpstreamServiceError)) return new ApiError(502, "UPSTREAM_FAILURE", "Tebligat işlemi tamamlanamadı. Lütfen tekrar deneyin.", true);
	if (error.isConfigurationError) return new ApiError(503, "SERVICE_UNAVAILABLE", "Tebligat hizmeti şu anda kullanılamıyor.", true);
	if (error.code === "UPSTREAM_TIMEOUT") return new ApiError(504, "UPSTREAM_TIMEOUT", "Tebligat hizmetine zamanında ulaşılamadı. Lütfen tekrar deneyin.", true);
	return new ApiError(502, "UPSTREAM_FAILURE", "Tebligat işlemi tamamlanamadı. Lütfen tekrar deneyin.", true);
}
function readMutation(body, requiresNumber) {
	if (typeof body.sayfa !== "string" || body.sayfa.trim().length === 0 || body.sayfa.length > 80 || typeof body.isim !== "string" || body.isim.trim().length === 0 || body.isim.length > 200) throw new ApiError(400, "VALIDATION_ERROR", "İşlem için geçerli tebligat bilgileri gerekli.");
	if (requiresNumber && typeof body.no !== "string" && typeof body.no !== "number") throw new ApiError(400, "VALIDATION_ERROR", "İşlem için geçerli tebligat numarası gerekli.");
	if (body.no !== void 0 && body.no !== null && String(body.no).length > 30) throw new ApiError(400, "VALIDATION_ERROR", "Tebligat numarasını kontrol edip tekrar deneyin.");
	return {
		sayfa: body.sayfa.trim(),
		isim: body.isim.trim(),
		...body.no !== void 0 && body.no !== null && String(body.no).trim() !== "" ? { no: String(body.no).trim() } : {}
	};
}
async function callSafe(action, parameters, environment) {
	try {
		return await callAppsScript(action, parameters, environment);
	} catch (error) {
		throw safeUpstreamFailure(error);
	}
}
/**
* Authenticates and proxies one supported tebligat API route.
* @param {Request} request Fetch API request.
* @param {object} environment Worker bindings including Apps Script configuration.
* @param {string} pathname API route path.
* @returns {Promise<unknown>} Sanitized upstream JSON payload.
* @throws {ApiError} When authorization, validation, or upstream checks fail.
*/
async function handleTebligatRequest(request, environment, pathname) {
	await requireStaff(request, environment);
	const mutation = MUTATIONS[pathname];
	if (mutation) {
		requireMethod(request, "POST");
		requireSameOrigin(request);
		const body = await readJsonBody(request);
		return callSafe(mutation.action, readMutation(body, mutation.requiresNumber), environment);
	}
	requireMethod(request, "GET");
	const url = new URL(request.url);
	if (pathname === "/api/get-all-tebligat") return callSafe("getAll", {}, environment);
	if (pathname !== "/api/search-tebligat") throw new ApiError(404, "NOT_FOUND", "İstenen kaynak bulunamadı.");
	const query = url.searchParams.get("q");
	const year = url.searchParams.get("year") || "2026";
	if (!query || query.trim().length < 2 || query.length > 100) throw new ApiError(400, "VALIDATION_ERROR", "En az iki karakterli bir arama girin.");
	if (!/^\d{4}$/.test(year)) throw new ApiError(400, "VALIDATION_ERROR", "Geçerli bir yıl seçin.");
	return callSafe("search", {
		q: query.trim(),
		year
	}, environment);
}
//#endregion
//#region src/server/domain/notificationTemplates.js
var NOTIFICATION_LANGUAGES = Object.freeze([
	"tr",
	"en",
	"ru",
	"tk",
	"ar"
]);
var NOTIFICATION_TEMPLATES = Object.freeze({
	application_received: Object.freeze({
		tr: "Başvurunuz alınmıştır. Güncel bilgileri güvenli başvuru portalından kontrol edebilirsiniz.",
		en: "Your application has been received. You can check current information in the secure application portal.",
		ru: "Ваше заявление получено. Проверить актуальную информацию можно на защищённом портале заявлений.",
		tk: "Arzaňyz kabul edildi. Täze maglumatlary howpsuz arzalar portalyndan barlap bilersiňiz.",
		ar: "تم استلام طلبك. يمكنك الاطلاع على المعلومات الحالية عبر بوابة الطلبات الآمنة."
	}),
	document_update_needed: Object.freeze({
		tr: "Başvurunuz için belge güncellemesi isteniyor. Lütfen güvenli başvuru portalını kontrol edin.",
		en: "A document update is requested for your application. Please check the secure application portal.",
		ru: "Для вашего заявления требуется обновить документ. Проверьте защищённый портал заявлений.",
		tk: "Arzaňyz üçin resminamany täzelemek talap edilýär. Howpsuz arzalar portalyndan barlaň.",
		ar: "مطلوب تحديث مستند لطلبك. يرجى مراجعة بوابة الطلبات الآمنة."
	}),
	status_updated: Object.freeze({
		tr: "Başvurunuzun durumunda güncelleme var. Ayrıntıları güvenli başvuru portalından kontrol edin.",
		en: "There is an update to your application status. Check the details in the secure application portal.",
		ru: "Статус вашего заявления обновлён. Подробности доступны на защищённом портале заявлений.",
		tk: "Arzaňyzyň ýagdaýy täzelendi. Jikme-jiklikleri howpsuz arzalar portalyndan görüň.",
		ar: "يوجد تحديث على حالة طلبك. راجع التفاصيل عبر بوابة الطلبات الآمنة."
	}),
	forwarded_to_migration: Object.freeze({
		tr: "Başvurunuz Göç İdaresine iletilmiştir. Güncel bilgileri güvenli başvuru portalından kontrol edin.",
		en: "Your application has been forwarded to the Migration Authority. Check current information in the secure application portal.",
		ru: "Ваше заявление передано в Управление миграции. Актуальная информация доступна на защищённом портале.",
		tk: "Arzaňyz Migrasiýa edarasyna iberildi. Täze maglumatlary howpsuz portaldan barlaň.",
		ar: "تمت إحالة طلبك إلى إدارة الهجرة. يمكنك مراجعة المعلومات الحالية عبر البوابة الآمنة."
	}),
	application_completed: Object.freeze({
		tr: "Başvurunuz tamamlanmıştır. Son bilgileri güvenli başvuru portalından kontrol edin.",
		en: "Your application is complete. Check the final information in the secure application portal.",
		ru: "Работа с вашим заявлением завершена. Итоговую информацию проверьте на защищённом портале.",
		tk: "Arzaňyz tamamlandy. Jemleýji maglumatlary howpsuz portaldan barlaň.",
		ar: "اكتمل طلبك. يرجى مراجعة المعلومات النهائية عبر بوابة الطلبات الآمنة."
	})
});
var TEMPLATE_STATUS_RULES = Object.freeze({
	application_received: /* @__PURE__ */ new Set([
		"submitted",
		"under_review",
		"resubmission_required",
		"approved_for_processing",
		"sent_to_migration",
		"migration_approved",
		"completed"
	]),
	document_update_needed: /* @__PURE__ */ new Set(["resubmission_required"]),
	status_updated: /* @__PURE__ */ new Set([
		"submitted",
		"under_review",
		"resubmission_required",
		"approved_for_processing",
		"sent_to_migration",
		"migration_approved",
		"completed",
		"cancelled",
		"rejected"
	]),
	forwarded_to_migration: /* @__PURE__ */ new Set([
		"sent_to_migration",
		"migration_approved",
		"completed"
	]),
	application_completed: /* @__PURE__ */ new Set(["completed"])
});
/** Builds the allowlisted static message and a normal same-origin tracking link. */
function buildNotificationMessage({ templateKey, language, origin }) {
	const message = NOTIFICATION_TEMPLATES[templateKey]?.[language];
	if (!message) throw new TypeError("Unsupported notification template or language.");
	const portalOrigin = new URL(origin);
	if (!["https:", "http:"].includes(portalOrigin.protocol) || portalOrigin.username || portalOrigin.password) throw new TypeError("Unsupported notification portal origin.");
	return `${message}\n${new URL("/basvurum/", portalOrigin.origin).href}`;
}
/** Checks that a selected template is truthful for the current application state. */
function canUseNotificationTemplate(templateKey, applicationStatus) {
	return TEMPLATE_STATUS_RULES[templateKey]?.has(applicationStatus) === true;
}
//#endregion
//#region src/server/services/notificationService.js
var WHATSAPP_CONSENT_VERSION = "whatsapp-consent-v1";
var SUPPORTED_CHANNELS = /* @__PURE__ */ new Set(["whatsapp", "email"]);
/** Normalizes a stored international phone number or rejects it as unavailable. */
function normalizeE164Phone(value) {
	if (typeof value !== "string" || !value.startsWith("+")) return null;
	const digits = value.slice(1).replace(/[\s().-]/g, "");
	if (!/^\d{8,15}$/.test(digits) || digits.startsWith("0")) return null;
	return `+${digits}`;
}
/** Returns a SHA-256 fingerprint used only to bind WhatsApp consent to the saved phone. */
async function hashNotificationPhone(phone) {
	const normalized = normalizeE164Phone(phone);
	if (!normalized) return null;
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Returns a minimal phone mask suitable for staff notification history. */
function maskNotificationRecipient(phone) {
	const normalized = normalizeE164Phone(phone);
	if (!normalized) return null;
	return `••••${normalized.slice(-2)}`;
}
/** Returns a masked email address suitable for staff notification history. */
function maskNotificationEmail(email) {
	if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
	const [local, domain] = email.trim().split("@");
	const domainParts = domain.split(".");
	const maskedDomain = domainParts.map((part, index) => index === domainParts.length - 1 ? part : `${part.slice(0, 1)}•••`).join(".");
	return `${local.slice(0, 1)}•••@${maskedDomain}`;
}
/** Checks whether an internal provider adapter is explicitly available. */
function isNotificationProviderConfigured(environment, channel) {
	const provider = environment?.NOTIFICATION_PROVIDERS?.[channel];
	return provider?.isConfigured === true && typeof provider.dispatch === "function";
}
function readBlockedReasons({ application, channel, templateKey, language, context, preferences, phoneHash, isProviderConfigured, isTemplateConfigured }) {
	const reasons = [];
	if (!application) return ["APPLICATION_NOT_FOUND"];
	if (!SUPPORTED_CHANNELS.has(channel)) return ["CHANNEL_UNAVAILABLE"];
	if (!Object.hasOwn(NOTIFICATION_TEMPLATES, templateKey) || !NOTIFICATION_LANGUAGES.includes(language)) return ["TEMPLATE_UNAVAILABLE"];
	if (!canUseNotificationTemplate(templateKey, application.status)) reasons.push("TEMPLATE_STATUS_MISMATCH");
	if (channel === "whatsapp") {
		if (!preferences.whatsapp_opt_in) reasons.push("WHATSAPP_CONSENT_REQUIRED");
		if (preferences.whatsapp_opt_in && preferences.whatsapp_consent_version !== "whatsapp-consent-v1") reasons.push("WHATSAPP_CONSENT_VERSION_STALE");
		if (!phoneHash) reasons.push("RECIPIENT_PHONE_UNAVAILABLE");
		if (preferences.whatsapp_opt_in && phoneHash !== preferences.whatsapp_phone_hash) reasons.push("WHATSAPP_CONSENT_PHONE_CHANGED");
		if (!context.student_phone) reasons.push("RECIPIENT_PHONE_UNAVAILABLE");
	}
	if (!isProviderConfigured) reasons.push(channel === "email" ? "EMAIL_PROVIDER_NOT_CONFIGURED" : "WHATSAPP_PROVIDER_NOT_CONFIGURED");
	if (channel === "whatsapp" && isProviderConfigured && !isTemplateConfigured) reasons.push("WHATSAPP_TEMPLATE_NOT_APPROVED");
	if (channel === "email" && !maskNotificationEmail(context.student_email)) reasons.push("RECIPIENT_EMAIL_UNAVAILABLE");
	return [...new Set(reasons)];
}
/** Resolves the server-derived recipient, consent, template, and provider gates for a preview. */
async function prepareNotificationPreview({ repositories, environment, applicationId, channel, templateKey, language, origin }) {
	const context = await repositories.notifications.readApplicationContext(applicationId);
	if (!context || context.status === "draft") throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	const preferences = await repositories.notifications.readPreferences(applicationId);
	const phoneHash = channel === "whatsapp" ? await hashNotificationPhone(context.student_phone) : null;
	const provider = environment?.NOTIFICATION_PROVIDERS?.[channel];
	const blockedReasons = readBlockedReasons({
		application: context,
		channel,
		templateKey,
		language,
		context,
		preferences,
		phoneHash,
		isProviderConfigured: isNotificationProviderConfigured(environment, channel),
		isTemplateConfigured: typeof provider?.isTemplateConfigured !== "function" || provider.isTemplateConfigured(templateKey, language) === true
	});
	let message = null;
	if (Object.hasOwn(NOTIFICATION_TEMPLATES, templateKey) && NOTIFICATION_LANGUAGES.includes(language)) message = buildNotificationMessage({
		templateKey,
		language,
		origin
	});
	return {
		channel,
		template_key: templateKey,
		language,
		recipient_masked: channel === "email" ? maskNotificationEmail(context.student_email) : maskNotificationRecipient(context.student_phone),
		message,
		can_send: blockedReasons.length === 0,
		blocked_reasons: blockedReasons
	};
}
/** Hashes only server-resolved notification content and application scope. */
function createEnqueueFingerprint(input) {
	const source = JSON.stringify({
		applicationId: input.applicationId,
		channel: input.channel,
		templateKey: input.templateKey,
		language: input.language,
		recipientMasked: input.recipientMasked,
		renderedMessage: input.renderedMessage
	});
	return crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)).then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}
/** Maps an internal send gate to a safe API error. */
function readEnqueueBlockedError(reason) {
	const [code, message] = {
		WHATSAPP_CONSENT_REQUIRED: ["WHATSAPP_CONSENT_REQUIRED", "Öğrencinin WhatsApp izni yok. Gönderim engellendi."],
		WHATSAPP_CONSENT_PHONE_CHANGED: ["WHATSAPP_CONSENT_PHONE_CHANGED", "Telefon değiştiği için yeni öğrenci izni gerekiyor."],
		WHATSAPP_CONSENT_VERSION_STALE: ["WHATSAPP_CONSENT_REQUIRED", "İzin metni güncellendiği için öğrenciden yeniden izin gerekiyor."],
		WHATSAPP_PROVIDER_NOT_CONFIGURED: ["PROVIDER_NOT_CONFIGURED", "WhatsApp sağlayıcısı yapılandırılmadı; gönderim devre dışı."],
		WHATSAPP_TEMPLATE_NOT_APPROVED: ["TEMPLATE_NOT_AVAILABLE", "Seçilen Meta şablonu bu dil için kurum tarafından onaylanmadı."],
		EMAIL_PROVIDER_NOT_CONFIGURED: ["PROVIDER_NOT_CONFIGURED", "E-posta sağlayıcısı yapılandırılmadı; gönderim devre dışı."],
		RECIPIENT_PHONE_UNAVAILABLE: ["RECIPIENT_UNAVAILABLE", "Başvuruda geçerli bir uluslararası telefon numarası yok."],
		RECIPIENT_EMAIL_UNAVAILABLE: ["RECIPIENT_UNAVAILABLE", "Başvuruda geçerli bir e-posta adresi yok."],
		TEMPLATE_STATUS_MISMATCH: ["TEMPLATE_NOT_AVAILABLE", "Bu şablon mevcut başvuru durumunda kullanılamaz."]
	}[reason] || ["NOTIFICATION_BLOCKED", "Bildirim şu anda gönderilemez."];
	return new ApiError(409, code, message);
}
//#endregion
//#region src/server/routes/applicantNotificationPreferenceRoutes.js
/** Reads notification consent through the current applicant session only. */
async function readCurrentNotificationPreferences(request, environment) {
	requireMethod(request, "GET");
	const session = await requireApplicationSession(request, environment);
	const repositories = createD1Repositories(environment.DB).notifications;
	const [preferences, application] = await Promise.all([repositories.readPreferences(session.application_id), repositories.readApplicationContext(session.application_id)]);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	return buildPreferenceResponse(session.application_id, preferences, application);
}
async function buildPreferenceResponse(applicationId, preferences, application) {
	const currentPhoneHash = await hashNotificationPhone(application.student_phone);
	const hasCurrentPhone = Boolean(currentPhoneHash);
	const isStoredConsent = preferences.whatsapp_opt_in === true;
	const isConsentVersionCurrent = preferences.whatsapp_consent_version === WHATSAPP_CONSENT_VERSION;
	const isConsentPhoneCurrent = hasCurrentPhone && currentPhoneHash === preferences.whatsapp_phone_hash;
	const requiresReconsent = isStoredConsent && (!isConsentVersionCurrent || !isConsentPhoneCurrent);
	return {
		application_id: applicationId,
		whatsapp_opt_in: preferences.whatsapp_opt_in,
		consent_version: preferences.whatsapp_consent_version,
		current_consent_version: WHATSAPP_CONSENT_VERSION,
		effective_whatsapp_opt_in: isStoredConsent && !requiresReconsent,
		requires_reconsent: requiresReconsent,
		can_opt_in: hasCurrentPhone,
		language: preferences.whatsapp_consent_language,
		opted_in_at: preferences.whatsapp_opt_in_at,
		opted_out_at: preferences.whatsapp_opt_out_at
	};
}
function validatePreferenceBody(body) {
	if (Object.keys(body).some((key) => ![
		"whatsapp_opt_in",
		"consent_version",
		"language"
	].includes(key)) || typeof body.whatsapp_opt_in !== "boolean") throw new ApiError(400, "VALIDATION_ERROR", "İletişim tercihini kontrol edip tekrar deneyin.");
	if (!body.whatsapp_opt_in) return {
		isOptedIn: false,
		consentVersion: null,
		language: null
	};
	if (body.consent_version !== "whatsapp-consent-v1" || !NOTIFICATION_LANGUAGES.includes(body.language)) throw new ApiError(400, "CONSENT_VERSION_INVALID", "İzin metnini yenileyip dil seçimini kontrol edin.");
	return {
		isOptedIn: true,
		consentVersion: body.consent_version,
		language: body.language
	};
}
/** Saves applicant-controlled WhatsApp consent using the authenticated owner session. */
async function updateCurrentNotificationPreferences(request, environment, requestId) {
	requireMethod(request, "PUT");
	requireSameOrigin(request);
	const session = await requireApplicationSession(request, environment);
	const selected = validatePreferenceBody(await readJsonBody(request));
	const repositories = createD1Repositories(environment.DB);
	const application = await repositories.notifications.readApplicationContext(session.application_id);
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	const phoneHash = selected.isOptedIn ? await hashNotificationPhone(application.student_phone) : null;
	if (selected.isOptedIn && !phoneHash) throw new ApiError(409, "RECIPIENT_UNAVAILABLE", "Başvuruda geçerli bir uluslararası telefon numarası yok.");
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const saved = await repositories.notifications.updateApplicantPreferences({
		applicationId: session.application_id,
		...selected,
		phoneHash,
		optedInAt: selected.isOptedIn ? now : null,
		optedOutAt: selected.isOptedIn ? null : now,
		updatedAt: now,
		requestId,
		auditEventId: crypto.randomUUID()
	});
	return buildPreferenceResponse(session.application_id, saved, application);
}
//#endregion
//#region src/server/routes/staffNotificationRoutes.js
var STAFF_ROLES = Object.freeze(["reviewer", "admin"]);
var CHANNELS = /* @__PURE__ */ new Set(["whatsapp", "email"]);
function requireOnlyKeys(body, keys) {
	if (Object.keys(body).some((key) => !keys.includes(key))) throw new ApiError(400, "VALIDATION_ERROR", "Bildirim alanlarını kontrol edip tekrar deneyin.");
}
function readSelection(body) {
	requireOnlyKeys(body, [
		"channel",
		"template_key",
		"language"
	]);
	if (!CHANNELS.has(body.channel) || !Object.hasOwn(NOTIFICATION_TEMPLATES, body.template_key) || !NOTIFICATION_LANGUAGES.includes(body.language)) throw new ApiError(400, "VALIDATION_ERROR", "Şablon, dil ve kanal seçimini kontrol edip tekrar deneyin.");
	return {
		channel: body.channel,
		templateKey: body.template_key,
		language: body.language
	};
}
function readIdempotencyKey(request) {
	const key = request.headers.get("Idempotency-Key") || "";
	if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Gönderim isteği anahtarı eksik. Yeniden deneyin.");
	return key;
}
async function prepareStaffContext(request, environment) {
	return {
		staff: await requireStaff(request, environment, STAFF_ROLES),
		repositories: createD1Repositories(environment.DB)
	};
}
/** Records and returns a staff preview without exposing recipient details. */
async function previewStaffNotification({ request, environment, applicationId, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const { staff, repositories } = await prepareStaffContext(request, environment);
	const selection = readSelection(await readJsonBody(request));
	const preview = await prepareNotificationPreview({
		repositories,
		environment,
		applicationId,
		...selection,
		origin: new URL(request.url).origin
	});
	await repositories.notifications.writeStaffPreviewAudit({
		auditEventId: crypto.randomUUID(),
		staffUserId: staff.id,
		applicationId,
		requestId,
		...selection,
		result: preview.can_send ? "ready" : "blocked"
	});
	return preview;
}
/** Reads masked notification history for a non-draft application. */
async function readStaffNotificationHistory({ request, environment, applicationId }) {
	requireMethod(request, "GET");
	const { repositories } = await prepareStaffContext(request, environment);
	const application = await repositories.notifications.readApplicationContext(applicationId);
	if (!application || application.status === "draft") throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	return { notifications: await repositories.notifications.listHistory(applicationId, 50) };
}
/** Enqueues an explicitly requested notification after rechecking current recipient and consent. */
async function enqueueStaffNotification({ request, environment, applicationId, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const { staff, repositories } = await prepareStaffContext(request, environment);
	const selection = readSelection(await readJsonBody(request));
	const idempotencyKey = readIdempotencyKey(request);
	const preview = await prepareNotificationPreview({
		repositories,
		environment,
		applicationId,
		...selection,
		origin: new URL(request.url).origin
	});
	const fingerprint = await createEnqueueFingerprint({
		applicationId,
		...selection,
		recipientMasked: preview.recipient_masked,
		renderedMessage: preview.message
	});
	const idempotencyScope = `staff-notification:${applicationId}`;
	try {
		const existing = await repositories.notifications.readIdempotentNotification({
			idempotencyScope,
			idempotencyKey,
			fingerprint
		});
		if (existing) return {
			queued: true,
			is_existing: true,
			notification: existing,
			max_attempts: 5
		};
	} catch (error) {
		if (error instanceof NotificationIdempotencyConflictError) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Aynı istek anahtarı farklı bir bildirim içeriğiyle kullanıldı.");
		throw error;
	}
	if (!preview.can_send) throw readEnqueueBlockedError(preview.blocked_reasons[0]);
	let result;
	try {
		result = await repositories.notifications.enqueueManualNotification({
			notificationId: crypto.randomUUID(),
			outboxId: crypto.randomUUID(),
			auditEventId: crypto.randomUUID(),
			applicationId,
			staffUserId: staff.id,
			...selection,
			recipientMasked: preview.recipient_masked,
			renderedMessage: preview.message,
			fingerprint,
			idempotencyKey,
			idempotencyScope,
			requestId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		});
	} catch (error) {
		if (error instanceof NotificationIdempotencyConflictError) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Aynı istek anahtarı farklı bir bildirim içeriğiyle kullanıldı.");
		throw error;
	}
	return {
		queued: true,
		is_existing: result.isExisting,
		notification: result.notification,
		max_attempts: 5
	};
}
/** Schedules an eligible transient failure for an immediate retry without dispatching it inline. */
async function retryStaffNotification({ request, environment, applicationId, notificationId, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	const staff = await requireStaff(request, environment, STAFF_ROLES);
	const repositories = createD1Repositories(environment.DB);
	const item = await repositories.notifications.findHistoryItem(applicationId, notificationId);
	if (!item) throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "Bildirim kaydı bulunamadı.");
	if (item.attempt_count >= 5 || item.provider_status !== "not_sent") throw new ApiError(409, "NOTIFICATION_RETRY_UNAVAILABLE", "Bu bildirim için güvenli tekrar gönderim yapılamıyor.");
	if (!await repositories.notifications.expediteRetry({
		applicationId,
		notificationId,
		staffUserId: staff.id,
		requestId,
		auditEventId: crypto.randomUUID(),
		now: (/* @__PURE__ */ new Date()).toISOString(),
		maxAttempts: 5
	})) throw new ApiError(409, "NOTIFICATION_RETRY_UNAVAILABLE", "Bu bildirim için güvenli tekrar gönderim yapılamıyor.");
	return {
		retry_scheduled: true,
		notification_id: notificationId
	};
}
/** Validates Meta's HMAC over the unchanged webhook body. */
async function verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret) {
	const signature = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader || "")?.[1];
	if (!signature || typeof appSecret !== "string" || appSecret.length === 0) return false;
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign"]);
	const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
	let difference = 0;
	for (let index = 0; index < digest.length; index += 1) difference |= digest[index] ^ Number.parseInt(signature.slice(index * 2, index * 2 + 2), 16);
	return difference === 0;
}
async function readBoundedBody(request) {
	const reader = request.body?.getReader();
	if (!reader) return /* @__PURE__ */ new Uint8Array();
	const chunks = [];
	let byteLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		byteLength += value.byteLength;
		if (byteLength > 262144) {
			await reader.cancel();
			throw new ApiError(413, "WEBHOOK_TOO_LARGE", "Webhook isteği çok büyük.");
		}
		chunks.push(value);
	}
	const body = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}
function readTimestamp(value) {
	if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) return null;
	const timestamp = /* @__PURE__ */ new Date(Number(value) * 1e3);
	return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}
function readStatusEvent(status) {
	if (typeof status?.status !== "string" || !/^[a-z_]{1,32}$/.test(status.status) || typeof status.id !== "string" || !status.id.startsWith("wamid.")) throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "Webhook içeriği doğrulanamadı.");
	const providerTimestamp = readTimestamp(status.timestamp);
	if (!providerTimestamp) throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "Webhook içeriği doğrulanamadı.");
	if (![
		"sent",
		"delivered",
		"read",
		"failed"
	].includes(status.status)) return null;
	return {
		providerMessageId: status.id,
		providerStatus: status.status,
		providerTimestamp
	};
}
function readStatusChange(change, expectedPhoneNumberId) {
	if (change?.field !== "messages") return [];
	const value = change.value;
	if (value?.metadata?.phone_number_id !== expectedPhoneNumberId) throw new ApiError(403, "WEBHOOK_SENDER_INVALID", "Webhook kaynağı doğrulanamadı.");
	if (value.messaging_product !== "whatsapp" || value.statuses !== void 0 && !Array.isArray(value.statuses)) throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "Webhook içeriği doğrulanamadı.");
	return (value.statuses || []).map(readStatusEvent).filter(Boolean);
}
function readStatusEvents(payload, expectedPhoneNumberId) {
	if (payload?.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "Webhook içeriği doğrulanamadı.");
	const events = [];
	for (const entry of payload.entry) {
		if (!Array.isArray(entry?.changes)) throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "Webhook içeriği doğrulanamadı.");
		for (const change of entry.changes) events.push(...readStatusChange(change, expectedPhoneNumberId));
	}
	if (events.length > 100) throw new ApiError(413, "WEBHOOK_TOO_LARGE", "Webhook olay sayısı çok fazla.");
	return events;
}
function readConstantTimeTokenMatch(expected, actual) {
	if (!expected || !actual || expected.length !== actual.length) return false;
	let difference = 0;
	for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
	return difference === 0;
}
function verifySubscription(request, environment) {
	const url = new URL(request.url);
	const challenge = url.searchParams.get("hub.challenge");
	if (!(url.searchParams.get("hub.mode") === "subscribe" && readConstantTimeTokenMatch(environment.WHATSAPP_WEBHOOK_VERIFY_TOKEN, url.searchParams.get("hub.verify_token"))) || !challenge || challenge.length > 256) throw new ApiError(403, "WEBHOOK_VERIFICATION_FAILED", "Webhook doğrulaması başarısız.");
	return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
async function acceptSignedEvents(request, environment, requestId) {
	if (typeof environment.WHATSAPP_PHONE_NUMBER_ID !== "string" || !/^\d{5,30}$/.test(environment.WHATSAPP_PHONE_NUMBER_ID) || typeof environment.WHATSAPP_APP_SECRET !== "string" || !environment.WHATSAPP_APP_SECRET) throw new ApiError(503, "WEBHOOK_NOT_CONFIGURED", "WhatsApp webhook yapılandırılmadı.");
	const rawBody = await readBoundedBody(request);
	if (!await verifyMetaWebhookSignature(rawBody, request.headers.get("X-Hub-Signature-256"), environment.WHATSAPP_APP_SECRET)) throw new ApiError(403, "WEBHOOK_SIGNATURE_INVALID", "Webhook imzası doğrulanamadı.");
	let payload;
	try {
		payload = JSON.parse(new TextDecoder().decode(rawBody));
	} catch {
		throw new ApiError(400, "WEBHOOK_PAYLOAD_INVALID", "Webhook içeriği doğrulanamadı.");
	}
	const events = readStatusEvents(payload, environment.WHATSAPP_PHONE_NUMBER_ID);
	const notifications = createD1Repositories(environment.DB).notifications;
	for (const event of events) {
		const notificationId = await notifications.findByProviderMessageId(event.providerMessageId);
		if (!notificationId) throw new ApiError(404, "WEBHOOK_MESSAGE_UNKNOWN", "Webhook bildirimi bulunamadı.");
		const eventId = await createEventId(event);
		await notifications.recordProviderStatusEvent({
			...event,
			eventId,
			notificationId,
			receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
			requestId
		});
	}
	return {
		received: true,
		processed: events.length
	};
}
/** Handles Meta webhook subscription verification and signed delivery status callbacks. */
async function handleMetaWhatsAppWebhook(request, environment, requestId) {
	if (request.method === "GET") return verifySubscription(request, environment);
	if (request.method === "POST") return acceptSignedEvents(request, environment, requestId);
	throw new ApiError(405, "METHOD_NOT_ALLOWED", "Bu istek yöntemi desteklenmiyor.");
}
async function createEventId(event) {
	const input = `${event.providerMessageId}\n${event.providerStatus}\n${event.providerTimestamp}`;
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
//#endregion
//#region src/server/services/metaWhatsAppProvider.js
var GRAPH_API_ORIGIN = "https://graph.facebook.com";
var PHONE_NUMBER_ID_PATTERN = /^\d{5,30}$/;
var API_VERSION_PATTERN = /^v\d{2,3}\.\d+$/;
var TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
function isPlainRecord(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
function readTemplate(environment, templateKey, language) {
	const selected = environment.WHATSAPP_APPROVED_TEMPLATES?.[templateKey]?.[language];
	if (!selected || !TEMPLATE_NAME_PATTERN.test(selected.name || "") || typeof selected.languageCode !== "string" || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(selected.languageCode)) throw Object.assign(/* @__PURE__ */ new Error("approved_template_unavailable"), { classification: "permanent" });
	return selected;
}
function isConfigured(environment) {
	return typeof environment.WHATSAPP_ACCESS_TOKEN === "string" && environment.WHATSAPP_ACCESS_TOKEN.length > 0 && PHONE_NUMBER_ID_PATTERN.test(environment.WHATSAPP_PHONE_NUMBER_ID || "") && API_VERSION_PATTERN.test(environment.WHATSAPP_CLOUD_API_VERSION || "") && isPlainRecord(environment.WHATSAPP_APPROVED_TEMPLATES) && Object.keys(environment.WHATSAPP_APPROVED_TEMPLATES).length > 0;
}
/** Creates a template-only Meta Cloud API adapter with an injectable transport for local tests. */
function createMetaWhatsAppProvider(environment, fetchImplementation = fetch) {
	const configured = isConfigured(environment);
	return Object.freeze({
		isConfigured: configured,
		isTemplateConfigured(templateKey, language) {
			if (!configured) return false;
			try {
				readTemplate(environment, templateKey, language);
				return true;
			} catch {
				return false;
			}
		},
		async dispatch(input) {
			if (!configured) throw Object.assign(/* @__PURE__ */ new Error("provider_not_configured"), { classification: "permanent" });
			const selectedTemplate = readTemplate(environment, input.templateKey, input.language);
			const recipient = input.recipient.replace(/^\+/, "");
			if (!/^\d{8,15}$/.test(recipient)) throw Object.assign(/* @__PURE__ */ new Error("recipient_invalid"), { classification: "permanent" });
			const response = await fetchImplementation(`${GRAPH_API_ORIGIN}/${environment.WHATSAPP_CLOUD_API_VERSION}/${environment.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${environment.WHATSAPP_ACCESS_TOKEN}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					messaging_product: "whatsapp",
					to: recipient,
					type: "template",
					template: {
						name: selectedTemplate.name,
						language: { code: selectedTemplate.languageCode }
					}
				})
			});
			if (!response.ok) {
				const classification = response.status === 429 ? "transient" : response.status >= 500 ? "unknown" : "permanent";
				throw Object.assign(/* @__PURE__ */ new Error("meta_provider_rejected"), { classification });
			}
			const messageId = (await response.json().catch(() => null))?.messages?.[0]?.id;
			if (typeof messageId !== "string" || !messageId.startsWith("wamid.")) throw Object.assign(/* @__PURE__ */ new Error("meta_provider_outcome_unknown"), { classification: "unknown" });
			return {
				status: "accepted",
				messageId
			};
		}
	});
}
var RETRY_DELAYS_SECONDS = Object.freeze([
	30,
	120,
	600,
	1800
]);
var REQUEST_ID = "notification-dispatcher";
function addSeconds(value, seconds) {
	return new Date(Date.parse(value) + seconds * 1e3).toISOString();
}
function readFailure(error) {
	if (error?.classification === "transient") return {
		type: "transient",
		code: "provider_transient_failure"
	};
	if (error?.classification === "permanent") return {
		type: "permanent",
		code: "provider_permanent_failure"
	};
	return {
		type: "unknown",
		code: "provider_result_unknown"
	};
}
function buildDispatchResult(result, claimed) {
	return {
		status: result,
		notification_id: claimed.notification_id
	};
}
async function recordFailure(repositories, input, classification) {
	if (classification.type === "transient" && input.attemptCount < 5) {
		const delay = RETRY_DELAYS_SECONDS[Math.min(input.attemptCount - 1, RETRY_DELAYS_SECONDS.length - 1)];
		await repositories.notifications.scheduleRetry({
			...input,
			errorCode: classification.code,
			now: input.now,
			nextAttemptAt: addSeconds(input.now, delay),
			auditEventId: crypto.randomUUID()
		});
		return "retry_scheduled";
	}
	await repositories.notifications.finishDispatch({
		...input,
		notificationStatus: "failed",
		providerStatus: classification.type === "unknown" ? "unknown" : "failed",
		providerMessageId: null,
		outboxStatus: "dead",
		errorCode: classification.code,
		failedAt: input.now,
		sentAt: null,
		auditEventId: crypto.randomUUID(),
		auditResult: classification.type === "unknown" ? "unknown" : "failed"
	});
	return classification.type === "unknown" ? "unknown" : "failed";
}
async function readCurrentSafeRecipient(envelope) {
	if (envelope.channel === "whatsapp") {
		const phone = normalizeE164Phone(envelope.student_phone);
		if (!phone || envelope.whatsapp_opt_in !== 1 || envelope.whatsapp_consent_version !== "whatsapp-consent-v1") return null;
		return await hashNotificationPhone(phone) === envelope.whatsapp_phone_hash ? phone : null;
	}
	if (envelope.channel === "email" && maskNotificationEmail(envelope.student_email)) return envelope.student_email.trim();
	return null;
}
/** Claims and dispatches one due notification using only an explicitly injected provider adapter. */
async function dispatchNextNotification({ database, provider, now = (/* @__PURE__ */ new Date()).toISOString() }) {
	if (!provider || typeof provider.dispatch !== "function") return { status: "provider_not_configured" };
	const repositories = createD1Repositories(database);
	const staleBefore = addSeconds(now, -300);
	await repositories.notifications.recoverAmbiguousDispatch({
		now,
		staleBefore,
		auditEventId: crypto.randomUUID(),
		requestId: REQUEST_ID
	});
	const leaseToken = crypto.randomUUID();
	const claimed = await repositories.notifications.claimNextOutbox({
		now,
		staleBefore,
		leaseToken
	});
	if (!claimed) return { status: "empty" };
	const envelope = await repositories.notifications.loadDispatchEnvelope(claimed.notification_id);
	if (!envelope) return buildDispatchResult("missing_envelope", claimed);
	const input = {
		notificationId: claimed.notification_id,
		applicationId: envelope.application_id,
		leaseToken,
		attemptCount: claimed.attempt_count,
		requestId: REQUEST_ID,
		now
	};
	if (!canUseNotificationTemplate(envelope.template_key, envelope.application_status)) return buildDispatchResult(await recordFailure(repositories, input, {
		type: "permanent",
		code: "application_state_changed"
	}), claimed);
	const recipient = await readCurrentSafeRecipient(envelope);
	if (!recipient) return buildDispatchResult(await recordFailure(repositories, input, {
		type: "permanent",
		code: envelope.channel === "whatsapp" ? "consent_or_phone_changed" : "recipient_unavailable"
	}), claimed);
	if (!await repositories.notifications.markDispatchStarted({
		notificationId: claimed.notification_id,
		leaseToken,
		now
	})) return buildDispatchResult("lease_lost", claimed);
	try {
		const providerResult = await provider.dispatch({
			channel: envelope.channel,
			recipient,
			message: envelope.rendered_message,
			templateKey: envelope.template_key,
			language: envelope.language,
			notificationId: envelope.id
		});
		if (providerResult?.status !== "accepted" && providerResult?.status !== "sent") return buildDispatchResult(await recordFailure(repositories, input, { type: "unknown" }), claimed);
		const isAccepted = providerResult.status === "accepted";
		await repositories.notifications.finishDispatch({
			...input,
			notificationStatus: isAccepted ? "queued" : "sent",
			providerStatus: providerResult.status,
			providerMessageId: typeof providerResult.messageId === "string" ? providerResult.messageId : null,
			outboxStatus: "sent",
			errorCode: null,
			failedAt: null,
			sentAt: isAccepted ? null : now,
			auditEventId: crypto.randomUUID(),
			auditResult: providerResult.status
		});
		return buildDispatchResult(providerResult.status, claimed);
	} catch (error) {
		return buildDispatchResult(await recordFailure(repositories, input, readFailure(error)), claimed);
	}
}
/** Runs the explicitly enabled, bounded background notification consumer. */
async function runNotificationDispatchBatch({ database, provider, isEnabled, now = (/* @__PURE__ */ new Date()).toISOString() }) {
	if (isEnabled !== true) return {
		status: "disabled",
		processed: 0
	};
	if (!database || typeof provider?.dispatch !== "function" || provider.isConfigured === false) return {
		status: "provider_not_configured",
		processed: 0
	};
	let processed = 0;
	for (; processed < 5; processed += 1) {
		const result = await dispatchNextNotification({
			database,
			provider,
			now
		});
		if (result.status === "empty" || result.status === "provider_not_configured") break;
	}
	return {
		status: "complete",
		processed
	};
}
//#endregion
//#region src/server/routes/staffApplicationDeletionRoutes.js
var RESTORABLE_STATES = /* @__PURE__ */ new Set(["soft_deleted"]);
function requireEmptyBody(body) {
	if (Object.keys(body).length !== 0) throw new ApiError(400, "INVALID_DELETE_REQUEST", "Silme isteği doğrulanamadı.");
}
async function verifyApplication(repository, applicationId) {
	const application = await repository.applications.findById(applicationId);
	if (!application || application.status === "draft") throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
	return application;
}
async function archiveApplication({ environment, applicationId, staff, requestId }) {
	const application = await verifyApplication(createD1Repositories(environment.DB), applicationId);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	if ((await environment.DB.batch([
		environment.DB.prepare(`INSERT INTO application_deletions
            (application_id,previous_status,state,deleted_by_staff_id,deleted_at)
            SELECT ?,?,'soft_deleted',?,? WHERE EXISTS(SELECT 1 FROM applications WHERE id=? AND status<>'draft')
            ON CONFLICT(application_id) DO NOTHING`).bind(applicationId, application.status, staff.id, now, applicationId),
		environment.DB.prepare(`DELETE FROM application_sessions WHERE application_id=? AND changes()=1`).bind(applicationId),
		environment.DB.prepare(`INSERT OR IGNORE INTO audit_events
            (id,event_type,actor_type,actor_staff_id,application_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'application.soft_deleted','staff',?,?,?,'{}',?
              WHERE EXISTS(SELECT 1 FROM application_deletions WHERE application_id=? AND state='soft_deleted')`).bind(`${applicationId}:soft-deleted`, staff.id, applicationId, requestId, now, applicationId)
	]))[0]?.meta?.changes !== 1) throw new ApiError(409, "APPLICATION_DELETE_CONFLICT", "Başvuru zaten arşivde veya siliniyor.");
	return { archived: true };
}
async function restoreApplication({ environment, applicationId, staff, requestId }) {
	const database = environment.DB;
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const deletion = await database.prepare(`SELECT previous_status,state FROM application_deletions WHERE application_id=?`).bind(applicationId).first();
	if (!deletion || !RESTORABLE_STATES.has(deletion.state)) throw new ApiError(409, "APPLICATION_NOT_RESTORABLE", "Bu başvuru geri alınamaz durumda.");
	const result = await database.batch([
		database.prepare(`UPDATE applications SET status=?,updated_at=?,last_activity_at=? WHERE id=?
            AND EXISTS(SELECT 1 FROM application_deletions WHERE application_id=? AND state='soft_deleted')`).bind(deletion.previous_status, now, now, applicationId, applicationId),
		database.prepare(`DELETE FROM application_deletions WHERE application_id=? AND state='soft_deleted' AND changes()=1`).bind(applicationId),
		database.prepare(`INSERT INTO audit_events
            (id,event_type,actor_type,actor_staff_id,application_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'application.restored','staff',?,?,?,'{}',? WHERE changes()=1`).bind(crypto.randomUUID(), staff.id, applicationId, requestId, now)
	]);
	if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1) throw new ApiError(409, "APPLICATION_DELETE_CONFLICT", "Başvuru durumu değişti. Listeyi yenileyin.");
	return { restored: true };
}
async function listApplicationStorageKeys(database, applicationId) {
	return (await database.prepare(`SELECT files.storage_key FROM document_revision_files AS files
        JOIN document_revisions AS revisions ON revisions.id=files.revision_id
        JOIN document_records AS records ON records.id=revisions.document_record_id
        WHERE records.application_id=? ORDER BY files.id`).bind(applicationId).all()).results.map((row) => row.storage_key);
}
async function hashApplicationId(applicationId) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(applicationId));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function purgeApplication({ environment, applicationId, staff, requestId }) {
	const database = environment.DB;
	const application = await database.prepare("SELECT student_id FROM applications WHERE id=?").bind(applicationId).first();
	if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Silinen başvuru bulunamadı.");
	const deletion = await database.prepare(`SELECT state FROM application_deletions WHERE application_id=?`).bind(applicationId).first();
	if (!deletion) throw new ApiError(404, "APPLICATION_NOT_FOUND", "Silinen başvuru bulunamadı.");
	if (deletion.state === "soft_deleted") {
		if ((await database.prepare(`UPDATE application_deletions SET state='purge_pending',purge_started_at=?
            WHERE application_id=? AND state='soft_deleted'`).bind((/* @__PURE__ */ new Date()).toISOString(), applicationId).run()).meta.changes !== 1) throw new ApiError(409, "APPLICATION_DELETE_CONFLICT", "Başvuru durumu değişti.");
	}
	await database.prepare("DELETE FROM application_sessions WHERE application_id=?").bind(applicationId).run();
	const storageKeys = await listApplicationStorageKeys(database, applicationId);
	for (const storageKey of storageKeys) try {
		await environment.DOCUMENTS.delete(storageKey);
	} catch {
		throw new ApiError(503, "APPLICATION_PURGE_RETRY_REQUIRED", "Dosyaların tamamı silinemedi. Kalıcı silme beklemede; tekrar deneyin.", true);
	}
	const anonymizedId = await hashApplicationId(applicationId);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const statements = [
		database.prepare(`DELETE FROM notification_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE application_id=?)`).bind(applicationId),
		database.prepare(`DELETE FROM notification_provider_webhook_events WHERE notification_id IN (SELECT id FROM notifications WHERE application_id=?)`).bind(applicationId),
		database.prepare(`DELETE FROM notification_preferences WHERE application_id=?`).bind(applicationId),
		database.prepare(`DELETE FROM notifications WHERE application_id=?`).bind(applicationId),
		database.prepare(`DELETE FROM idempotency_records WHERE resource_id=?`).bind(applicationId),
		database.prepare(`DELETE FROM assignments WHERE application_id=?`).bind(applicationId),
		database.prepare(`DELETE FROM application_notes WHERE application_id=?`).bind(applicationId),
		database.prepare(`DELETE FROM document_scan_jobs WHERE file_id IN (SELECT files.id FROM document_revision_files AS files JOIN document_revisions AS revisions ON revisions.id=files.revision_id JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
		database.prepare(`DELETE FROM upload_intents WHERE revision_file_id IN (SELECT files.id FROM document_revision_files AS files JOIN document_revisions AS revisions ON revisions.id=files.revision_id JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
		database.prepare(`DELETE FROM audit_events WHERE application_id=? OR document_record_id IN (SELECT id FROM document_records WHERE application_id=?)`).bind(applicationId, applicationId),
		database.prepare(`DELETE FROM document_revision_files WHERE revision_id IN (SELECT revisions.id FROM document_revisions AS revisions JOIN document_records AS records ON records.id=revisions.document_record_id WHERE records.application_id=?)`).bind(applicationId),
		database.prepare(`DELETE FROM document_revisions WHERE document_record_id IN (SELECT id FROM document_records WHERE application_id=?)`).bind(applicationId),
		database.prepare(`DELETE FROM document_records WHERE application_id=?`).bind(applicationId),
		database.prepare(`DELETE FROM application_deletions WHERE application_id=?`).bind(applicationId),
		database.prepare(`DELETE FROM applications WHERE id=?`).bind(applicationId),
		database.prepare(`DELETE FROM students WHERE id=? AND NOT EXISTS (SELECT 1 FROM applications WHERE student_id=?)`).bind(application.student_id, application.student_id),
		database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,request_id,safe_metadata_json,created_at)
            VALUES(?,'application.permanently_purged','system',?,?,?)`).bind(crypto.randomUUID(), requestId, JSON.stringify({ application_id_sha256: anonymizedId }), now)
	];
	try {
		await database.batch(statements);
	} catch {
		throw new ApiError(503, "APPLICATION_PURGE_RETRY_REQUIRED", "Başvuru verileri tamamen silinemedi. Kalıcı silme beklemede; tekrar deneyin.", true);
	}
	return { purged: true };
}
async function dispatchAction({ action, request, environment, applicationId, requestId }) {
	requireMethod(request, "POST");
	requireSameOrigin(request);
	requireEmptyBody(await readJsonBody(request, 1024));
	const staff = await requireStaff(request, environment, action === "purge" ? ["admin"] : ["reviewer", "admin"]);
	if (action === "archive") return archiveApplication({
		environment,
		applicationId,
		staff,
		requestId
	});
	if (action === "restore") return restoreApplication({
		environment,
		applicationId,
		staff,
		requestId
	});
	return purgeApplication({
		environment,
		applicationId,
		staff,
		requestId
	});
}
/** Handles same-origin staff archive, restore, and administrator purge actions. */
function handleStaffApplicationDeletion(request, environment, applicationId, action, requestId) {
	return dispatchAction({
		action,
		request,
		environment,
		applicationId,
		requestId
	});
}
//#endregion
//#region src/server/services/d1BackupService.js
/**
* D1 Database automated snapshot backup service for R2 bucket storage.
* Exports all user tables to structured JSON snapshots with metadata and retention.
*/
/**
* Performs a full snapshot of all user tables in D1 and persists it to R2.
* @param {object} options
* @param {object} options.database Cloudflare D1 binding (env.DB).
* @param {object} options.storage Cloudflare R2 bucket binding (env.DOCUMENTS).
* @param {string} [options.environmentName] Target environment name ('staging' | 'production').
* @returns {Promise<{success: boolean, backupKey: string, latestKey: string, tableCount: number, stats: Record<string, number>, sizeBytes: number}>}
*/
async function backupD1ToR2({ database, storage, environmentName = "production" }) {
	if (!database || typeof database.prepare !== "function") throw new Error("D1 database binding is required for backup.");
	if (!storage || typeof storage.put !== "function") throw new Error("R2 storage binding is required for backup.");
	const tableNames = ((await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_migrations' ORDER BY name ASC").all()).results || []).map((row) => row.name);
	const backupData = {
		metadata: {
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			environment: environmentName,
			tableCount: tableNames.length
		},
		stats: {},
		tables: {}
	};
	for (const tableName of tableNames) {
		if (!/^[a-zA-Z0-9_]+$/.test(tableName)) continue;
		const rows = (await database.prepare(`SELECT * FROM ${tableName}`).all()).results || [];
		backupData.tables[tableName] = rows;
		backupData.stats[tableName] = rows.length;
	}
	const totalRecords = Object.values(backupData.stats).reduce((a, b) => a + b, 0);
	backupData.metadata.recordCount = totalRecords;
	const jsonString = JSON.stringify(backupData, null, 2);
	const backupKey = `backups/${environmentName}/${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}/d1-backup-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.json`;
	const latestKey = `backups/${environmentName}/latest.json`;
	await storage.put(backupKey, jsonString, {
		httpMetadata: { contentType: "application/json" },
		customMetadata: {
			environment: environmentName,
			createdAt: backupData.metadata.timestamp,
			tableCount: String(tableNames.length),
			recordCount: String(totalRecords)
		}
	});
	await storage.put(latestKey, jsonString, {
		httpMetadata: { contentType: "application/json" },
		customMetadata: {
			environment: environmentName,
			createdAt: backupData.metadata.timestamp,
			tableCount: String(tableNames.length),
			recordCount: String(totalRecords),
			originalKey: backupKey
		}
	});
	return {
		success: true,
		backupKey,
		latestKey,
		tableCount: tableNames.length,
		stats: backupData.stats,
		sizeBytes: jsonString.length
	};
}
/**
* Retrieves metadata about the latest backup stored in R2.
* @param {object} storage R2 bucket binding.
* @param {string} environmentName Environment name.
* @returns {Promise<object|null>}
*/
async function getLatestBackupMetadata(storage, environmentName = "production") {
	if (!storage || typeof storage.head !== "function") return null;
	const latestKey = `backups/${environmentName}/latest.json`;
	const object = await storage.head(latestKey);
	if (!object) return null;
	return {
		key: latestKey,
		originalKey: object.customMetadata?.originalKey || latestKey,
		createdAt: object.customMetadata?.createdAt || object.uploaded?.toISOString?.(),
		tableCount: object.customMetadata?.tableCount ? Number(object.customMetadata.tableCount) : null,
		recordCount: object.customMetadata?.recordCount ? Number(object.customMetadata.recordCount) : null,
		sizeBytes: object.size
	};
}
//#endregion
//#region src/server/routes/printerRoutes.js
async function hashValue(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hashBytes(value) {
	const digest = await crypto.subtle.digest("SHA-256", value);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function requirePrinter(request, environment) {
	const expected = environment.PRINTER_SECRET;
	if (typeof expected !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(expected)) throw new ApiError(503, "PRINTER_UNAVAILABLE", "Yazdırma hizmeti kullanılamıyor.", true);
	if (new URL(request.url).protocol !== "https:") throw new ApiError(403, "HTTPS_REQUIRED", "Güvenli bağlantı gerekli.");
	const provided = request.headers.get("Authorization")?.startsWith("Bearer ") ? request.headers.get("Authorization").slice(7) : "";
	const [expectedHash, providedHash] = await Promise.all([hashValue(expected), hashValue(provided.slice(0, 256))]);
	let difference = 0;
	for (let index = 0; index < expectedHash.length; index += 1) difference |= expectedHash.charCodeAt(index) ^ providedHash.charCodeAt(index);
	if (difference !== 0 || provided.length > 256) throw new ApiError(401, "UNAUTHORIZED", "Yazdırma agent yetkisi gerekli.");
	if (!environment.DB || !environment.PRINT_FILES) throw new ApiError(503, "PRINTER_UNAVAILABLE", "Yazdırma hizmeti kullanılamıyor.", true);
}
function requireIdentifier(value) {
	if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
	throw new ApiError(400, "INVALID_PRINT_INPUT", "Yazdırma isteği doğrulanamadı.");
}
async function readLease(request, repository, jobId) {
	const tokenHash = await hashValue(request.headers.get("X-Print-Lease") || "");
	const job = await repository.findLease({
		id: jobId,
		tokenHash,
		now: (/* @__PURE__ */ new Date()).toISOString()
	});
	if (!job) throw new ApiError(409, "PRINT_LEASE_INVALID", "Yazdırma işi artık bu agent tarafından sahiplenilemiyor.");
	return {
		job,
		tokenHash
	};
}
async function heartbeat(request, repository) {
	requireMethod(request, "POST");
	const body = await readJsonBody(request, 1024);
	const keys = Object.keys(body).sort().join(",");
	const legacyKeys = "health,printer_id,printer_name,runner_id";
	if (![
		legacyKeys,
		"health,printer_id,printer_name,runner_id,settings_protocol",
		"health,printer_id,printer_name,runner_id,settings_protocol"
	].includes(keys) || !["ready", "unavailable"].includes(body.health) || keys !== legacyKeys && ![
		1,
		2,
		3
	].includes(body.settings_protocol) || typeof body.printer_name !== "string" || body.printer_name.trim().length < 1 || body.printer_name.length > 128 || /[\u0000-\u001f\u007f]/.test(body.printer_name)) throw new ApiError(400, "INVALID_PRINT_INPUT", "Yazdırma agent durumu doğrulanamadı.");
	const printerId = requireIdentifier(body.printer_id);
	const runnerId = requireIdentifier(body.runner_id);
	await repository.heartbeat({
		printerId,
		runnerId,
		health: body.health,
		printerName: body.printer_name,
		settingsProtocol: body.settings_protocol || 0,
		now: (/* @__PURE__ */ new Date()).toISOString()
	});
	return { recorded: true };
}
async function claim(request, repository, environment) {
	requireMethod(request, "POST");
	const body = await readJsonBody(request, 1024);
	if (Object.keys(body).length !== 1) throw new ApiError(400, "INVALID_PRINT_INPUT", "Yazdırma isteği doğrulanamadı.");
	const runnerId = requireIdentifier(body.runner_id);
	const uatPolicy = readPrintUatPolicy(environment);
	const uatJobId = uatPolicy ? await readPrintUatJobId(environment.DB) : null;
	if (uatPolicy && !uatJobId) return { job: null };
	const leaseToken = [...crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	await repository.reconcile((/* @__PURE__ */ new Date()).toISOString());
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const limits = readPrintLimits(environment);
	if (!limits.isValid) return { job: null };
	const job = await repository.claim({
		now,
		runnerId,
		leaseTokenHash: await hashValue(leaseToken),
		limits: uatPolicy ? {
			...limits,
			maxCopies: 1
		} : limits,
		jobId: uatJobId,
		minimumProtocol: uatPolicy ? 3 : 0,
		uatExpiresAt: readPrintUatDeadline(environment)
	});
	if (!job) return { job: null };
	return { job: {
		id: job.id,
		media_type: job.media_type,
		byte_size: job.byte_size,
		copies: job.copies,
		paper_size: job.paper_size,
		color_mode: job.color_mode,
		duplex: job.duplex,
		orientation: job.orientation,
		limits: {
			max_copies: limits.maxCopies,
			max_page_copies: limits.maxPageCopies
		},
		lease_until: job.lease_until,
		lease_token: leaseToken
	} };
}
async function readContent(request, environment, repository, jobId) {
	requireMethod(request, "GET");
	const { job, tokenHash } = await readLease(request, repository, jobId);
	if (job.byte_size > 10485760) throw new ApiError(409, "PRINT_LEASE_INVALID", "Yazdırma işi doğrulanamadı.");
	const storage = createPrintStorage(environment.PRINT_FILES, {
		accountId: environment.R2_ACCOUNT_ID,
		bucketName: environment.PRINT_BUCKET_NAME,
		accessKeyId: environment.PRINT_R2_ACCESS_KEY_ID,
		secretAccessKey: environment.PRINT_R2_SECRET_ACCESS_KEY
	});
	const object = await storage.head(job.storage_key);
	if (!object || object.size !== job.byte_size || object.httpMetadata?.contentType !== job.media_type) throw new ApiError(409, "PRINT_CONTENT_INVALID", "Yazdırma dosyası doğrulanamadı.");
	const content = await storage.get(job.storage_key);
	if (!content || typeof content.arrayBuffer !== "function" || content.etag !== object.etag) throw new ApiError(409, "PRINT_CONTENT_INVALID", "Yazdırma dosyası doğrulanamadı.");
	const bytes = new Uint8Array(await content.arrayBuffer());
	await requirePrintUatContent(bytes, environment);
	if (bytes.length !== job.byte_size || !await repository.touchLease({
		id: job.id,
		tokenHash,
		now: (/* @__PURE__ */ new Date()).toISOString()
	})) throw new ApiError(409, "PRINT_LEASE_INVALID", "Yazdırma işi artık bu agent tarafından sahiplenilemiyor.");
	const sha256 = await hashBytes(bytes);
	return new Response(bytes, { headers: {
		"Content-Type": "application/octet-stream",
		"Content-Length": String(bytes.length),
		"X-Content-SHA256": sha256,
		"Cache-Control": "private, no-store",
		"X-Content-Type-Options": "nosniff"
	} });
}
async function handleJobRequest(request, environment, repository, jobId, action) {
	if (action !== "result") await requirePrintUatJob(jobId, environment);
	if (action === "content") requireMethod(request, "GET");
	else requireMethod(request, "POST");
	if (action === "content") return readContent(request, environment, repository, jobId);
	const { job, tokenHash } = await readLease(request, repository, jobId);
	if (action === "validation-result") {
		const body = await readJsonBody(request, 1024);
		if (body.status === "failed" && Object.keys(body).length === 2 && [
			"validation_failed",
			"unsupported_content",
			"invalid_print_options",
			"page_copy_budget_exceeded"
		].includes(body.result_code)) {
			if (!await repository.markValidationFailed({
				id: jobId,
				tokenHash,
				resultCode: body.result_code,
				now: (/* @__PURE__ */ new Date()).toISOString()
			})) throw new ApiError(409, "PRINT_LEASE_INVALID", "Yazdırma işi artık bu agent tarafından sahiplenilemiyor.");
			return { ready: false };
		}
		if (body.status !== "ready" || Object.keys(body).length !== 2 || !Number.isInteger(body.page_count) || body.page_count < 1 || body.page_count > 20) throw new ApiError(400, "PRINT_PAGE_LIMIT", "Belge sayfa sınırını aşıyor.");
		if (readPrintUatPolicy(environment) && body.page_count !== 1) throw new ApiError(400, "PRINT_PAGE_LIMIT", "UAT belgesi tek sayfa olmalıdır.");
		const limits = readPrintLimits(environment);
		if (!limits.isValid) throw new ApiError(503, "PRINT_UNAVAILABLE", "Yazdırma şu anda kullanılamıyor.", true);
		if (body.page_count * job.copies > limits.maxPageCopies) {
			await repository.markValidationFailed({
				id: jobId,
				tokenHash,
				resultCode: "page_copy_budget_exceeded",
				now: (/* @__PURE__ */ new Date()).toISOString()
			});
			return {
				ready: false,
				result_code: "page_copy_budget_exceeded"
			};
		}
		if (!await repository.markReady({
			id: jobId,
			tokenHash,
			pageCount: body.page_count,
			maxPageCopies: limits.maxPageCopies,
			now: (/* @__PURE__ */ new Date()).toISOString(),
			uatExpiresAt: readPrintUatDeadline(environment)
		})) throw new ApiError(409, "PRINT_LEASE_INVALID", "Yazdırma işi artık bu agent tarafından sahiplenilemiyor.");
		return { ready: true };
	}
	if (action === "submission-started") {
		if (Object.keys(await readJsonBody(request, 256)).length) throw new ApiError(400, "INVALID_PRINT_INPUT", "Yazdırma isteği doğrulanamadı.");
		if (!await repository.markSubmissionStarted({
			id: jobId,
			tokenHash,
			now: (/* @__PURE__ */ new Date()).toISOString(),
			uatExpiresAt: readPrintUatDeadline(environment)
		})) throw new ApiError(409, "PRINT_SUBMISSION_LOCKED", "Yazdırma işi tekrar gönderilemez.");
		return { submission_started: true };
	}
	const result = validatePrintResult(await readJsonBody(request, 1024));
	if (!await repository.recordResult({
		id: jobId,
		tokenHash,
		result,
		now: (/* @__PURE__ */ new Date()).toISOString()
	})) throw new ApiError(409, "PRINT_LEASE_INVALID", "Yazdırma sonucu kabul edilmedi.");
	return { recorded: true };
}
async function handlePrinterRequest(request, environment) {
	await requirePrinter(request, environment);
	const repository = createPrintRepository(environment.DB);
	const pathname = new URL(request.url).pathname;
	if (pathname === "/api/printer/heartbeat") return heartbeat(request, repository);
	if (pathname === "/api/printer/claim") return claim(request, repository, environment);
	const match = pathname.match(/^\/api\/printer\/jobs\/([A-Za-z0-9_-]{1,64})\/(content|validation-result|submission-started|result)$/);
	if (match) return handleJobRequest(request, environment, repository, match[1], match[2]);
	if (pathname === "/api/printer/reconcile") {
		requireMethod(request, "GET");
		const runnerId = requireIdentifier(request.headers.get("X-Printer-Runner"));
		return { jobs: await repository.listSubmissionStarted(runnerId) };
	}
	throw new ApiError(404, "NOT_FOUND", "İstenen kaynak bulunamadı.");
}
async function readStaffPrintStatus(request, environment) {
	requireMethod(request, "GET");
	await requireStaff(request, environment, ["reviewer", "admin"]);
	return createPrintRepository(environment.DB).readStaffStatus((/* @__PURE__ */ new Date()).toISOString());
}
//#endregion
//#region src/server/services/printCleanupService.js
async function runPrintCleanup(environment, now = (/* @__PURE__ */ new Date()).toISOString()) {
	const repository = createPrintRepository(environment.DB);
	const storage = createPrintStorage(environment.PRINT_FILES);
	const pending = await repository.reconcile(now);
	for (const job of pending) try {
		await storage.delete(job.storage_key);
		await repository.markObjectDeleted({
			id: job.id,
			now
		});
	} catch (error) {
		console.error("[Print cleanup] Object deletion failed.", {
			jobId: job.id,
			errorName: error?.name || "UnknownError"
		});
		await repository.incrementCleanupAttempt({
			id: job.id,
			now
		});
	}
	await repository.purgeOldRows(now);
}
//#endregion
//#region src/server/worker.js
function apiErrorFromUnknown(error) {
	if (error instanceof ApiError) return error;
	if (error instanceof RepositoryConfigurationError) return new ApiError(503, "SERVICE_UNAVAILABLE", "Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.", true);
	return new ApiError(500, "INTERNAL_ERROR", "İşlem tamamlanamadı. Lütfen daha sonra tekrar deneyin.", true);
}
function safeRouteResponse(result, requestId) {
	if (result instanceof Response) {
		const headers = new Headers(result.headers);
		headers.set("X-Request-Id", requestId);
		if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
		return new Response(result.body, {
			status: result.status,
			statusText: result.statusText,
			headers
		});
	}
	if (isRouteResult(result)) {
		const headers = result.cookie ? { "Set-Cookie": result.cookie } : {};
		return jsonResponse(result.body, result.status, requestId, headers);
	}
	return jsonResponse(result ?? {}, 200, requestId);
}
function withMetaWhatsAppProvider(environment) {
	if (environment.NOTIFICATION_PROVIDERS?.whatsapp) return environment;
	return {
		...environment,
		NOTIFICATION_PROVIDERS: {
			...environment.NOTIFICATION_PROVIDERS,
			whatsapp: createMetaWhatsAppProvider(environment)
		}
	};
}
async function routeApi(request, environment, requestId) {
	const { pathname } = new URL(request.url);
	await requirePrintRequestAccess(request, environment);
	if (pathname.startsWith("/api/printer/")) return handlePrinterRequest(request, environment);
	if (pathname === "/api/public/print/status") return readPublicPrintStatus(request, environment);
	if (pathname === "/api/staff/print/uat/status") return readStaffPrintUatStatus(request, environment);
	const uatUploadMatch = pathname.match(/^\/api\/public\/print\/jobs\/([A-Za-z0-9_-]{1,64})\/upload$/);
	if (uatUploadMatch) return uploadPrintUatDocument(request, environment, uatUploadMatch[1]);
	if (pathname === "/api/public/print/upload-intents") return createPublicPrintUploadIntent(request, environment);
	if (pathname === "/api/public/print/jobs/status") return readPublicPrintJobStatus(request, environment);
	const printFinalizeMatch = pathname.match(/^\/api\/public\/print\/jobs\/([A-Za-z0-9_-]{1,64})\/finalize$/);
	if (printFinalizeMatch) return finalizePublicPrintUpload(request, environment, printFinalizeMatch[1]);
	if (pathname === "/api/staff/print/status") return readStaffPrintStatus(request, environment);
	if (pathname.startsWith("/api/scanner/")) return handleScannerRequest(request, environment);
	const documentScanMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/documents\/([^/]+)\/scan$/);
	if (documentScanMatch) {
		let applicationId;
		let documentCode;
		try {
			applicationId = decodeURIComponent(documentScanMatch[1]);
			documentCode = decodeURIComponent(documentScanMatch[2]);
		} catch {
			throw new ApiError(404, "DOCUMENT_NOT_AVAILABLE", "Belge mevcut değil veya erişilemiyor.");
		}
		return prioritizeStaffDocumentScan(request, environment, applicationId, documentCode, requestId);
	}
	if (["/api/staff/scanner/status", "/api/staff/scanner/retry"].includes(pathname)) return handleStaffScannerRequest(request, environment, requestId);
	const deletionMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/(archive|restore|purge)$/);
	if (deletionMatch) {
		let applicationId;
		try {
			applicationId = decodeURIComponent(deletionMatch[1]);
		} catch {
			throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
		}
		return handleStaffApplicationDeletion(request, environment, applicationId, deletionMatch[2], requestId);
	}
	if (pathname === "/api/webhooks/whatsapp") return handleMetaWhatsAppWebhook(request, environment, requestId);
	const archiveManifestMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/documents\/archive-manifest$/);
	if (archiveManifestMatch) {
		let applicationId;
		try {
			applicationId = decodeURIComponent(archiveManifestMatch[1]);
		} catch {
			throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
		}
		return createStaffApplicationArchiveManifest({
			request,
			environment,
			applicationId,
			requestId
		});
	}
	const archiveFileMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/documents\/([^/]+)\/archive-file$/);
	if (archiveFileMatch) {
		let applicationId;
		let documentCode;
		try {
			applicationId = decodeURIComponent(archiveFileMatch[1]);
			documentCode = decodeURIComponent(archiveFileMatch[2]);
		} catch {
			throw new ApiError(404, "DOCUMENT_NOT_AVAILABLE", "Belge mevcut değil veya erişilemiyor.");
		}
		return streamStaffApplicationArchiveFile({
			request,
			environment,
			applicationId,
			code: documentCode,
			requestId
		});
	}
	const notificationRetryMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/notifications\/([^/]+)\/retry$/);
	if (notificationRetryMatch) {
		let applicationId;
		let notificationId;
		try {
			applicationId = decodeURIComponent(notificationRetryMatch[1]);
			notificationId = decodeURIComponent(notificationRetryMatch[2]);
		} catch {
			throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "Bildirim kaydı bulunamadı.");
		}
		return retryStaffNotification({
			request,
			environment,
			applicationId,
			notificationId,
			requestId
		});
	}
	const staffNotificationMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/notifications(?:\/(preview))?$/);
	if (staffNotificationMatch) {
		let applicationId;
		try {
			applicationId = decodeURIComponent(staffNotificationMatch[1]);
		} catch {
			throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
		}
		if (staffNotificationMatch[2]) return previewStaffNotification({
			request,
			environment: withMetaWhatsAppProvider(environment),
			applicationId,
			requestId
		});
		if (request.method === "GET") return readStaffNotificationHistory({
			request,
			environment,
			applicationId
		});
		return enqueueStaffNotification({
			request,
			environment: withMetaWhatsAppProvider(environment),
			applicationId,
			requestId
		});
	}
	if (pathname === "/api/staff/auth/login" || pathname === "/api/login") return loginStaff(request, environment, requestId);
	if (pathname === "/api/staff/auth/session" || pathname === "/api/session") return readStaffSession(request, environment);
	if (pathname === "/api/staff/auth/logout" || pathname === "/api/logout") return logoutStaff(request, environment, requestId);
	if (pathname === "/api/staff/auth/bootstrap") return bootstrapStaff(request, environment, requestId);
	if (pathname === "/api/staff/applications/query") return queryStaffApplications(request, environment);
	const staffStatusMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/status$/);
	if (staffStatusMatch) {
		let applicationId;
		try {
			applicationId = decodeURIComponent(staffStatusMatch[1]);
		} catch {
			throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
		}
		return transitionStaffApplicationStatus({
			request,
			environment,
			applicationId,
			requestId
		});
	}
	const staffDocumentMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/documents\/([^/]+)\/(preview|download|approve|unapprove|request-resubmission)$/);
	if (staffDocumentMatch) {
		let applicationId;
		let documentCode;
		try {
			applicationId = decodeURIComponent(staffDocumentMatch[1]);
			documentCode = decodeURIComponent(staffDocumentMatch[2]);
		} catch {
			throw new ApiError(404, "DOCUMENT_NOT_AVAILABLE", "Belge mevcut değil veya erişilemiyor.");
		}
		if (staffDocumentMatch[3] === "preview") return createStaffDocumentPreview({
			request,
			environment,
			applicationId,
			code: documentCode,
			requestId
		});
		if (staffDocumentMatch[3] === "download") return downloadStaffApplicationDocument({
			request,
			environment,
			applicationId,
			code: documentCode,
			requestId
		});
		if (staffDocumentMatch[3] === "approve") return approveStaffApplicationDocument({
			request,
			environment,
			applicationId,
			code: documentCode,
			requestId
		});
		if (staffDocumentMatch[3] === "unapprove") return unapproveStaffApplicationDocument({
			request,
			environment,
			applicationId,
			code: documentCode,
			requestId
		});
		return requestStaffDocumentResubmission({
			request,
			environment,
			applicationId,
			code: documentCode,
			requestId
		});
	}
	const staffResetMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)\/reset-access-code$/);
	if (staffResetMatch) {
		let applicationId;
		try {
			applicationId = decodeURIComponent(staffResetMatch[1]);
		} catch {
			throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
		}
		return resetStaffApplicationAccessCode({
			request,
			environment,
			applicationId,
			requestId
		});
	}
	const staffApplicationMatch = pathname.match(/^\/api\/staff\/applications\/([^/]+)$/);
	if (staffApplicationMatch) {
		let applicationId;
		try {
			applicationId = decodeURIComponent(staffApplicationMatch[1]);
		} catch {
			throw new ApiError(404, "APPLICATION_NOT_FOUND", "Başvuru bulunamadı.");
		}
		return readStaffApplicationDetail(request, environment, applicationId);
	}
	if (pathname === "/api/public/applications/access") return accessApplicationWithReference(request, environment, requestId);
	if (pathname === "/api/public/applications/current/regenerate-access-code") return regenerateCurrentAccessCode(request, environment, requestId);
	if (pathname === "/api/public/applications") return createApplicationDraft(request, environment, requestId);
	if (pathname === "/api/public/applications/current/status") return readCurrentApplicationStatus(request, environment);
	if (pathname === "/api/public/applications/current/tracking") return readCurrentApplicationTracking(request, environment);
	if (pathname === "/api/public/applications/current/notification-preferences") {
		if (request.method === "PUT") return updateCurrentNotificationPreferences(request, environment, requestId);
		return readCurrentNotificationPreferences(request, environment);
	}
	if (pathname === "/api/public/applications/tracking-lookup") return lookupApplicationTracking(request, environment);
	if (pathname === "/api/public/applications/current/submit") return submitCurrentApplication(request, environment, requestId);
	if (pathname === "/api/public/applications/current/declaration") return acceptCurrentApplicationDeclaration(request, environment, requestId);
	if (pathname === "/api/public/applications/current/contact-acknowledgement") return acceptCurrentContactAcknowledgement(request, environment, requestId);
	if (pathname === "/api/public/applications/current/documents") return readCurrentStudentDocumentRequirements(request, environment);
	if (pathname === "/api/public/applications/current/documents/resubmission-eligibility") return readCurrentResubmissionEligibility(request, environment);
	if (pathname === "/api/public/applications/current/documents/resubmission-upload-intent") return createCurrentResubmissionUploadIntent(request, environment, requestId);
	if (pathname === "/api/public/applications/current/documents/resubmission-finalize") return finalizeCurrentResubmissionUpload(request, environment, requestId);
	if (pathname === "/api/public/applications/current/documents/upload-intent") return createCurrentStudentDocumentUploadIntent(request, environment);
	if (pathname === "/api/public/applications/current/documents/finalize") return finalizeCurrentStudentDocument(request, environment);
	const studentDocumentMatch = pathname.match(/^\/api\/public\/applications\/current\/documents\/([^/]+)$/);
	if (studentDocumentMatch) return deleteCurrentStudentDocument(request, environment, decodeURIComponent(studentDocumentMatch[1]));
	if (pathname === "/api/public/applications/current/autosave") return autosaveCurrentApplication(request, environment, requestId);
	if (pathname === "/api/public/applications/current") {
		if (request.method === "PATCH") return updateCurrentApplication(request, environment, requestId);
		return readCurrentApplication(request, environment);
	}
	if (pathname === "/api/public/applications/logout") return logoutApplication(request, environment);
	const documentMatch = pathname.match(/^\/api\/staff\/documents\/([^/]+)\/content$/);
	if (documentMatch) return readPrivateDocument(request, environment, decodeURIComponent(documentMatch[1]));
	if (pathname === "/api/ocr") return recognizeDocument(request, environment);
	if (pathname.startsWith("/api/") && [
		"/api/get-all-tebligat",
		"/api/search-tebligat",
		"/api/add-tebligat",
		"/api/update-tebligat",
		"/api/unmark-tebligat",
		"/api/remove-tebligat"
	].includes(pathname)) return handleTebligatRequest(request, environment, pathname);
	if (pathname === "/api/staff/admin/backup") {
		await requireStaff(request, environment);
		requireMethod(request, "POST");
		return backupD1ToR2({
			database: environment.DB,
			storage: environment.DOCUMENTS,
			environmentName: environment.APP_ENV || "production"
		});
	}
	if (pathname === "/api/staff/admin/backup/latest") {
		await requireStaff(request, environment);
		requireMethod(request, "GET");
		return { latest: await getLatestBackupMetadata(environment.DOCUMENTS, environment.APP_ENV || "production") };
	}
	throw new ApiError(404, "NOT_FOUND", "İstenen kaynak bulunamadı.");
}
//#endregion
//#region \0virtual:cloudflare/worker-entry
var worker_entry_default = {
	async fetch(request, environment) {
		const requestId = createRequestId();
		const { pathname } = new URL(request.url);
		if (!pathname.startsWith("/api/")) {
			if (environment.ASSETS) return environment.ASSETS.fetch(request);
			return new Response("Not Found", { status: 404 });
		}
		try {
			return safeRouteResponse(await routeApi(request, environment, requestId), requestId);
		} catch (error) {
			const apiError = apiErrorFromUnknown(error);
			if (apiError.status >= 500) console.error("Worker request failed.", {
				requestId,
				errorName: error?.name || "UnknownError",
				errorCode: apiError.code
			});
			return errorResponse(requestId, apiError.status, apiError.code, apiError.message, apiError.retryable);
		}
	},
	async scheduled(controller, environment) {
		if (controller.cron === "* * * * *") {
			if (environment.DB && environment.PRINT_FILES) try {
				await runPrintCleanup(environment);
			} catch (cleanupError) {
				console.error("[Scheduled] Print cleanup failed.", { errorName: cleanupError?.name || "UnknownError" });
				throw cleanupError;
			}
			return;
		}
		if (environment.DB && environment.DOCUMENTS && typeof environment.DOCUMENTS.put === "function") try {
			await backupD1ToR2({
				database: environment.DB,
				storage: environment.DOCUMENTS,
				environmentName: environment.APP_ENV || "production"
			});
		} catch (backupError) {
			console.error("[Scheduled] D1 automated backup failed:", backupError);
		}
		const provider = createMetaWhatsAppProvider(environment);
		return runNotificationDispatchBatch({
			database: environment.DB,
			provider,
			isEnabled: environment.NOTIFICATION_DISPATCH_ENABLED === "true"
		});
	}
};
//#endregion
export { worker_entry_default as default };
