import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_OPTIONS } from '../../shared/document-conditions.js';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES } from '../../public/i18n/messages.js';
import { ApiError } from './errors.js';
import { listApplicationDocumentPolicies } from './documentPolicy.js';
import { CHATBOT_LANGUAGES, CHATBOT_TOPICS, readKnowledge } from './chatbotKnowledge.js';

const TOOL_APPLICATION_TYPES = Object.freeze(['initial', 'renewal', 'transition']);
const FINGERPRINT_STATUSES = Object.freeze(['registered', 'not_registered']);

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requirePlainArgs(rawArgs) {
    if (!isPlainObject(rawArgs)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Araç parametreleri geçersiz.');
    }
    return rawArgs;
}

function resolveLanguage(language) {
    const normalized = typeof language === 'string' ? language.trim().toLowerCase() : '';
    return CHATBOT_LANGUAGES.includes(normalized) ? normalized : 'tr';
}

function validateLookupKnowledgeArgs(rawArgs) {
    const args = requirePlainArgs(rawArgs);
    const topic = args.topic;
    if (typeof topic !== 'string' || !CHATBOT_TOPICS.includes(topic)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Geçersiz bilgi konusu.');
    }
    return { topic };
}

function validateEnumField(args, key, allowedValues, defaultValue = null) {
    if (!Object.hasOwn(args, key) || args[key] === undefined) return defaultValue;
    const value = args[key];
    if (typeof value !== 'string' || !allowedValues.includes(value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Geçersiz araç parametresi: ${key}.`);
    }
    return value;
}

function validateRequiredDocumentsArgs(rawArgs) {
    const args = requirePlainArgs(rawArgs);
    const applicationType = validateEnumField(args, 'application_type', TOOL_APPLICATION_TYPES, null);
    if (!applicationType) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru türü zorunludur.');
    }

    let isUnder18 = false;
    if (Object.hasOwn(args, 'is_under_18') && args.is_under_18 !== undefined) {
        if (typeof args.is_under_18 !== 'boolean') {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Geçersiz araç parametresi: is_under_18.');
        }
        isUnder18 = args.is_under_18;
    }

    return {
        application_type: applicationType,
        is_under_18: isUnder18,
        accommodation_type: validateEnumField(args, 'accommodation_type', ACCOMMODATION_TYPES, null),
        host_is_married: validateEnumField(args, 'host_is_married', DOCUMENT_ANSWER_OPTIONS.host_is_married, null),
        host_is_turkish: validateEnumField(args, 'host_is_turkish', DOCUMENT_ANSWER_OPTIONS.host_is_turkish, null),
        fingerprint_status: validateEnumField(args, 'fingerprint_status', FINGERPRINT_STATUSES, null)
    };
}

function buildPolicyApplication(validated) {
    return {
        application_type: validated.application_type === 'transition' ? 'renewal' : validated.application_type,
        application_route: validated.application_type === 'transition' ? 'transition' : 'standard',
        is_under_18: validated.is_under_18 ? 1 : 0,
        address_evidence_type: validated.accommodation_type,
        accommodation_type: validated.accommodation_type && validated.accommodation_type !== 'residence_certificate'
            ? validated.accommodation_type : null,
        host_is_married: validated.host_is_married,
        host_is_turkish: validated.host_is_turkish,
        fingerprint_status: validated.fingerprint_status,
        fingerprint_code: validated.fingerprint_status === 'registered' ? 'registered' : null
    };
}

/**
 * Registry of deterministic server-executed chatbot tools with JSON schemas and strict validators.
 */
export const CHATBOT_TOOLS = Object.freeze({
    lookup_knowledge: Object.freeze({
        name: 'lookup_knowledge',
        description: 'Look up curated, office-approved portal information on application steps, residence permit basics, office hours, student card referrals, or office contact.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                topic: Object.freeze({
                    type: 'string',
                    enum: [...CHATBOT_TOPICS],
                    description: 'Fixed knowledge base topic to read.'
                })
            }),
            required: Object.freeze(['topic']),
            additionalProperties: false
        }),
        execute(rawArgs, context = {}) {
            const { topic } = validateLookupKnowledgeArgs(rawArgs);
            return readKnowledge(topic, resolveLanguage(context?.language));
        }
    }),
    get_required_documents: Object.freeze({
        name: 'get_required_documents',
        description: 'Return the exact required residence permit documents from the server document policy for the student’s application type, age group, accommodation type, and host/fingerprint conditions.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                application_type: Object.freeze({
                    type: 'string',
                    enum: [...TOOL_APPLICATION_TYPES],
                    description: 'Student residence permit application type.'
                }),
                is_under_18: Object.freeze({
                    type: 'boolean',
                    description: 'Whether the applicant is under 18 years old on the e-İkamet application date.'
                }),
                accommodation_type: Object.freeze({
                    type: 'string',
                    enum: [...ACCOMMODATION_TYPES],
                    description: 'How the student documents their address in Türkiye.'
                }),
                host_is_married: Object.freeze({
                    type: 'string',
                    enum: [...DOCUMENT_ANSWER_OPTIONS.host_is_married],
                    description: 'Only when accommodation_type is undertaking: whether the host is married.'
                }),
                host_is_turkish: Object.freeze({
                    type: 'string',
                    enum: [...DOCUMENT_ANSWER_OPTIONS.host_is_turkish],
                    description: 'Only when accommodation_type is undertaking: whether the host is a Turkish citizen.'
                }),
                fingerprint_status: Object.freeze({
                    type: 'string',
                    enum: [...FINGERPRINT_STATUSES],
                    description: 'Only when application_type is transition: whether the student has a Migration Authority fingerprint registration and code.'
                })
            }),
            required: Object.freeze(['application_type']),
            additionalProperties: false
        }),
        execute(rawArgs, context = {}) {
            const validated = validateRequiredDocumentsArgs(rawArgs);
            const documents = listApplicationDocumentPolicies(buildPolicyApplication(validated));
            const locale = resolveLanguage(context?.language);
            const messages = {
                ...(SESSION3_MESSAGES[locale] || SESSION3_MESSAGES.tr),
                ...(PUBLIC_MESSAGES[locale] || PUBLIC_MESSAGES.tr)
            };
            const labels = documents.map((policy) => ({
                code: policy.code,
                required: policy.required,
                title: messages[policy.label_key] || policy.label_key,
                help: messages[policy.description_key] || ''
            }));
            return { documents, labels };
        }
    }),
    handoff_to_office: Object.freeze({
        name: 'handoff_to_office',
        description: 'Direct the student to the home page question form so the International Student Office can answer directly.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({}),
            additionalProperties: false
        }),
        execute() {
            return { action: { type: 'inquiry' } };
        }
    })
});

export const CHATBOT_TOOL_DEFINITIONS = Object.freeze(
    Object.values(CHATBOT_TOOLS).map((tool) => Object.freeze({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
    }))
);

/**
 * Validates and executes one registered chatbot tool by exact name.
 * @param {string} name Registered tool name.
 * @param {unknown} rawArgs Untrusted tool arguments from the model.
 * @param {{language?: string}} [context] Request context.
 * @returns {object} Deterministic tool output.
 * @throws {ApiError} When the tool name or arguments are invalid.
 */
export function executeChatbotTool(name, rawArgs, context = {}) {
    if (typeof name !== 'string' || !Object.hasOwn(CHATBOT_TOOLS, name)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Geçersiz araç adı.');
    }
    return CHATBOT_TOOLS[name].execute(rawArgs, context);
}
