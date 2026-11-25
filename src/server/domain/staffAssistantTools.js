/**
 * Staff Topi assistant tool definitions, strict argument validators, and read-only / proposal executors.
 * Tool results are rendered deterministically and are NEVER fed back into a model call.
 */

import { OFFICE_DOCUMENTS } from '../../config/documents-config.js';
import {
    STAFF_ASSISTANT_MAX_COPIES,
    STAFF_ASSISTANT_PEOPLE,
    STAFF_ASSISTANT_VIEWS
} from '../../shared/staff-assistant-contract.js';
import { requireStaff } from '../auth/staffAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { createStaffAssistantRepository } from '../repositories/d1/staffAssistantRepository.js';
import { ApiError } from './errors.js';
import { normalizeTurkishText, resolvePerson } from './staffAssistantIntent.js';

const APPLICATION_SEARCH_ROLES = Object.freeze(['reviewer', 'admin']);
const MAX_RESULT_ITEMS = 5;
const PASSPORT_NO_PATTERN = /^[A-Z0-9]{5,20}$/;
const YOKSIS_STATUS_CATEGORIES = Object.freeze([
    'all',
    'successful',
    'pending',
    'rejected',
    'missing_documents',
    'unreadable',
    'other'
]);

const PEOPLE_DISPLAY_NAMES = Object.freeze({
    kagan_samet: 'Kağan Samet',
    asaf: 'Asaf',
    eyup: 'Eyüp',
    oguz: 'Oğuz',
    eray: 'Eray'
});

const VIEW_LABELS = Object.freeze({
    applications: 'Başvurular',
    cover: 'Kapak',
    documents: 'Belgeler',
    inquiries: 'Gelen Sorular',
    physical: 'Fiziki Başvurular',
    print: 'Yazdırma',
    teblig: 'Tebligat',
    'work-hours': 'Çalışma Saatleri',
    ykn: 'YKN',
    'yoksis-audit': 'YÖKSİS Eksik Evrak'
});

const TODAY_DATE_TOKENS = new Set(['', 'bugun', 'bugune', 'bugunku', 'today']);

/**
 * Frozen list of tools exposed to the model for staff assistant intent selection.
 * No destructive, approval, Apply-request, or YÖKSİS-save tool exists here.
 * @type {readonly Array<{ name: string, description: string, parameters: object }>}
 */
export const STAFF_ASSISTANT_TOOLS = Object.freeze([
    Object.freeze({
        name: 'search_applications',
        description: 'Öğrenci başvurularında başvuru referansı, öğrenci no, ad, soyad veya pasaport no ile salt okunur arama yapar.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                query: Object.freeze({ type: 'string', description: 'Aranacak referans no, öğrenci no, ad, soyad veya pasaport no.' })
            }),
            required: Object.freeze(['query']),
            additionalProperties: false
        })
    }),
    Object.freeze({
        name: 'lookup_yoksis_audit',
        description: 'YÖKSİS eksik evrak kayıtlarında ad, soyad, öğrenci no, pasaport no veya durum kategorisine göre salt okunur arama yapar.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                query: Object.freeze({ type: 'string', description: 'Aranacak ad, soyad, öğrenci no veya pasaport no.' }),
                status: Object.freeze({ type: 'string', enum: YOKSIS_STATUS_CATEGORIES, description: 'İsteğe bağlı durum filtresi.' })
            }),
            additionalProperties: false
        })
    }),
    Object.freeze({
        name: 'propose_work_hours',
        description: 'Bugün için 30 dakikalık adımlarla çalışma saati önerisi hazırlar; veritabanına yazmaz.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                person: Object.freeze({ type: 'string', description: 'Personel anahtarı veya adı (kagan_samet, asaf, eyup, oguz, eray).' }),
                hours: Object.freeze({ type: 'number', description: 'Saat cinsinden çalışma süresi (ör. 6.5).' }),
                minutes: Object.freeze({ type: 'number', description: 'Dakika cinsinden çalışma süresi (0..1440, 30 katı).' }),
                dateText: Object.freeze({ type: 'string', description: 'İstenen tarih ifadesi; yalnızca bugün desteklenir.' })
            }),
            additionalProperties: false
        })
    }),
    Object.freeze({
        name: 'propose_documents_print',
        description: 'Ofis belgelerinden birini 1 ile 50 arasında kopya olarak yazdırmayı önerir.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                documentId: Object.freeze({ type: 'string', description: 'Belgeler listesindeki belge kimliği.' }),
                query: Object.freeze({ type: 'string', description: 'Belge adı veya anahtar sözcüğü.' }),
                copies: Object.freeze({ type: 'number', description: 'Kopya sayısı (1..50).' })
            }),
            additionalProperties: false
        })
    }),
    Object.freeze({
        name: 'run_ykn_flow',
        description: 'Verilen pasaport numarası için YKN otomatik zincirini başlatır; YÖKSİS Kaydet tuşuna basmaz ve Apply talep göndermez.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                passportNo: Object.freeze({ type: 'string', description: 'Öğrencinin pasaport numarası (5-20 alfanümerik karakter).' })
            }),
            required: Object.freeze(['passportNo']),
            additionalProperties: false
        })
    }),
    Object.freeze({
        name: 'search_tebligat',
        description: 'Tebligat kayıtlarında ad veya numaraya göre salt okunur arama yapar ve sonucu sohbette gösterir.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                query: Object.freeze({ type: 'string', description: 'Tebligat araması için ad veya numara (2-80 karakter).' })
            }),
            required: Object.freeze(['query']),
            additionalProperties: false
        })
    }),
    Object.freeze({
        name: 'navigate',
        description: 'Yetkili panelde belirtilen ekrana geçiş yapar.',
        parameters: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                view: Object.freeze({ type: 'string', enum: STAFF_ASSISTANT_VIEWS, description: 'Hedef ekran kimliği.' })
            }),
            required: Object.freeze(['view']),
            additionalProperties: false
        })
    })
]);

const TOOL_NAMES = new Set(STAFF_ASSISTANT_TOOLS.map((tool) => tool.name));
const ALLOWED_KEYS_BY_TOOL = Object.freeze({
    search_applications: new Set(['query']),
    lookup_yoksis_audit: new Set(['query', 'status']),
    propose_work_hours: new Set(['person', 'hours', 'minutes', 'dateText']),
    propose_documents_print: new Set(['documentId', 'query', 'copies']),
    run_ykn_flow: new Set(['passportNo']),
    search_tebligat: new Set(['query']),
    navigate: new Set(['view'])
});

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function escapeLikeTerm(value) {
    return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function normalizeAuditSearch(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Strictly validates tool name and arguments against the closed per-tool schema.
 * Rejects unknown tools, unknown argument keys, and invalid value types.
 * @param {string} name Candidate tool name.
 * @param {unknown} rawArgs Candidate argument object.
 * @returns {object} Validated argument object.
 * @throws {Error} Throws `Error('invalid-tool-args')` when validation fails.
 */
export function validateStaffToolArgs(name, rawArgs) {
    if (typeof name !== 'string' || !TOOL_NAMES.has(name) || !isPlainObject(rawArgs)) {
        throw new Error('invalid-tool-args');
    }
    const allowedKeys = ALLOWED_KEYS_BY_TOOL[name];
    for (const key of Object.keys(rawArgs)) {
        if (!allowedKeys.has(key)) {
            throw new Error('invalid-tool-args');
        }
    }

    switch (name) {
    case 'search_applications': {
        if (typeof rawArgs.query !== 'string') throw new Error('invalid-tool-args');
        const query = rawArgs.query.trim();
        if (query.length < 1 || query.length > 120) throw new Error('invalid-tool-args');
        return { query };
    }
    case 'lookup_yoksis_audit': {
        const result = {};
        if (rawArgs.query !== undefined) {
            if (typeof rawArgs.query !== 'string' || rawArgs.query.trim().length > 120) {
                throw new Error('invalid-tool-args');
            }
            result.query = rawArgs.query.trim();
        }
        if (rawArgs.status !== undefined) {
            if (typeof rawArgs.status !== 'string' || !YOKSIS_STATUS_CATEGORIES.includes(rawArgs.status)) {
                throw new Error('invalid-tool-args');
            }
            result.status = rawArgs.status;
        }
        return result;
    }
    case 'propose_work_hours': {
        const result = {};
        if (rawArgs.person !== undefined) {
            if (typeof rawArgs.person !== 'string' || rawArgs.person.length > 80) {
                throw new Error('invalid-tool-args');
            }
            result.person = rawArgs.person.trim();
        }
        if (rawArgs.hours !== undefined) {
            if (typeof rawArgs.hours !== 'number' || !Number.isFinite(rawArgs.hours)) {
                throw new Error('invalid-tool-args');
            }
            result.hours = rawArgs.hours;
        }
        if (rawArgs.minutes !== undefined) {
            if (typeof rawArgs.minutes !== 'number' || !Number.isFinite(rawArgs.minutes)) {
                throw new Error('invalid-tool-args');
            }
            result.minutes = rawArgs.minutes;
        }
        if (rawArgs.dateText !== undefined) {
            if (typeof rawArgs.dateText !== 'string' || rawArgs.dateText.length > 80) {
                throw new Error('invalid-tool-args');
            }
            result.dateText = rawArgs.dateText.trim();
        }
        return result;
    }
    case 'propose_documents_print': {
        const result = {};
        if (rawArgs.documentId !== undefined) {
            if (typeof rawArgs.documentId !== 'string' || rawArgs.documentId.length > 80) {
                throw new Error('invalid-tool-args');
            }
            result.documentId = rawArgs.documentId.trim();
        }
        if (rawArgs.query !== undefined) {
            if (typeof rawArgs.query !== 'string' || rawArgs.query.length > 120) {
                throw new Error('invalid-tool-args');
            }
            result.query = rawArgs.query.trim();
        }
        if (rawArgs.copies !== undefined) {
            if (typeof rawArgs.copies !== 'number' || !Number.isFinite(rawArgs.copies)) {
                throw new Error('invalid-tool-args');
            }
            result.copies = rawArgs.copies;
        }
        return result;
    }
    case 'run_ykn_flow': {
        if (typeof rawArgs.passportNo !== 'string' || rawArgs.passportNo.length > 40) {
            throw new Error('invalid-tool-args');
        }
        return { passportNo: rawArgs.passportNo.trim() };
    }
    case 'search_tebligat': {
        if (typeof rawArgs.query !== 'string' || rawArgs.query.length > 120) {
            throw new Error('invalid-tool-args');
        }
        return { query: rawArgs.query.trim() };
    }
    case 'navigate': {
        if (typeof rawArgs.view !== 'string' || !STAFF_ASSISTANT_VIEWS.includes(rawArgs.view)) {
            throw new Error('invalid-tool-args');
        }
        return { view: rawArgs.view };
    }
    default:
        throw new Error('invalid-tool-args');
    }
}

async function resolveStaffForTool(context, roles) {
    if (context?.staff) {
        if (roles && !roles.includes(context.staff.role)) {
            throw new ApiError(403, 'FORBIDDEN', 'Bu işlem için yetkiniz yok.');
        }
        return context.staff;
    }
    return requireStaff(context.request, context.environment, roles);
}

async function runSearchApplications(args, context) {
    await resolveStaffForTool(context, APPLICATION_SEARCH_ROLES);
    const repositories = createD1Repositories(context.environment.DB);
    const result = await repositories.applications.queryStaffApplications({
        statuses: null,
        isDraft: false,
        isDeleted: false,
        includeDeleted: false,
        searchPattern: escapeLikeTerm(args.query),
        pageSize: MAX_RESULT_ITEMS,
        offset: 0
    });

    const staffAssistantRepo = createStaffAssistantRepository(context.environment.DB);
    const referenceById = await staffAssistantRepo.getApplicationReferenceNumbers(
        result.items.map((item) => item.id)
    );

    const items = result.items.slice(0, MAX_RESULT_ITEMS).map((item) => ({
        id: String(item.id),
        referenceNumber: String(referenceById.get(item.id) ?? ''),
        studentNumber: String(item.student_number ?? ''),
        firstName: String(item.first_name ?? ''),
        lastName: String(item.last_name ?? ''),
        passportNumber: String(item.passport_number ?? ''),
        status: String(item.status ?? ''),
        submittedAt: item.submitted_at ?? null
    }));

    const total = Number.isInteger(result.totalItems) ? result.totalItems : items.length;
    const results = { kind: 'applications', total, items };

    if (total === 0) {
        return {
            reply: `"${args.query}" için eşleşen başvuru bulunamadı. Başvuru araması yalnızca başvuru referansı, öğrenci no, ad, soyad ve pasaport no ile yapılır (telefon ve e-posta ile arama yoktur).`,
            state: 'confused',
            results
        };
    }

    if (total > MAX_RESULT_ITEMS) {
        return {
            reply: `İlk ${MAX_RESULT_ITEMS} başvuru listelendi (toplam ${total}; tümünü görmek için Başvurular ekranını açın).`,
            state: 'understood',
            action: { type: 'navigate', view: 'applications' },
            results
        };
    }

    return {
        reply: `${total} başvuru bulundu.`,
        state: 'understood',
        results
    };
}

function parseMissingDocuments(documentsJson) {
    try {
        const parsed = JSON.parse(documentsJson || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.map((doc) => ({
            name: String(doc?.name ?? ''),
            required: Boolean(doc?.required),
            note: String(doc?.note ?? '')
        }));
    } catch {
        return [];
    }
}

async function runLookupYoksisAudit(args, context) {
    await resolveStaffForTool(context);
    const staffAssistantRepo = createStaffAssistantRepository(context.environment.DB);
    const normalizedQuery = normalizeAuditSearch(args.query || '');
    const status = args.status || 'all';

    const latestImport = await staffAssistantRepo.findLatestFinalizedYoksisImport();
    const { total, rows } = await staffAssistantRepo.queryYoksisAuditRecords({
        normalizedQuery,
        status,
        limit: MAX_RESULT_ITEMS
    });

    const items = rows.slice(0, MAX_RESULT_ITEMS).map((row) => ({
        applicationNumber: String(row.application_number ?? ''),
        studentNumber: String(row.student_number ?? ''),
        fullName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
        applicationStatus: String(row.application_status ?? ''),
        statusCategory: String(row.status_category ?? ''),
        missingDocuments: parseMissingDocuments(row.documents_json),
        missingDeadline: row.missing_deadline ?? null,
        unit: String(row.unit ?? ''),
        scannedAt: row.scanned_at ?? null,
        isStale: Boolean(
            latestImport?.id
            && row.source === 'excel'
            && row.last_seen_import_id !== latestImport.id
        )
    }));

    const results = {
        kind: 'yoksisAudit',
        total,
        lastImportAt: latestImport?.uploadedAt ?? null,
        items
    };

    if (total === 0) {
        return {
            reply: 'YÖKSİS eksik evrak kayıtlarında eşleşen sonuç bulunamadı.',
            state: 'confused',
            results
        };
    }

    if (total > MAX_RESULT_ITEMS) {
        return {
            reply: `İlk ${MAX_RESULT_ITEMS} YÖKSİS kaydı listelendi (toplam ${total}; tümünü görmek için YÖKSİS Eksik Evrak ekranını açın).`,
            state: 'understood',
            action: { type: 'navigate', view: 'yoksis-audit' },
            results
        };
    }

    return {
        reply: `${total} YÖKSİS eksik evrak kaydı bulundu.`,
        state: 'understood',
        results
    };
}

function formatHoursLabel(minutes) {
    const hours = minutes / 60;
    const formatted = Number.isInteger(hours) ? String(hours) : String(hours).replace('.', ',');
    return `${formatted} saat`;
}

async function runProposeWorkHours(args, context) {
    await resolveStaffForTool(context);

    if (args.dateText) {
        const normalizedDate = normalizeTurkishText(args.dateText);
        if (!TODAY_DATE_TOKENS.has(normalizedDate)) {
            return {
                reply: 'Çalışma saati yalnızca bugün için girilebilir; geçmiş veya gelecek tarihler desteklenmiyor.',
                state: 'confused'
            };
        }
    }

    let personKey = null;
    if (args.person) {
        if (STAFF_ASSISTANT_PEOPLE.includes(args.person)) {
            personKey = args.person;
        } else {
            const resolved = resolvePerson(args.person);
            if (typeof resolved === 'string') {
                personKey = resolved;
            }
        }
    }
    if (!personKey) {
        return {
            reply: 'Hangi personel için çalışma saati gireyim? Seçenekler: Kağan Samet, Asaf, Eyüp, Oğuz, Eray.',
            state: 'confused'
        };
    }

    let totalMinutes = null;
    if (args.minutes !== undefined) {
        totalMinutes = args.minutes;
    } else if (args.hours !== undefined) {
        totalMinutes = args.hours * 60;
    }

    if (totalMinutes === null || !Number.isFinite(totalMinutes)) {
        return {
            reply: 'Kaç saat çalışma süresi gireyim? (30 dakikalık adımlarla, 0 ile 24 saat arasında)',
            state: 'confused'
        };
    }

    if (totalMinutes < 0 || totalMinutes > 1440) {
        return {
            reply: 'Çalışma süresi 0 ile 24 saat (0–1440 dakika) arasında olmalıdır.',
            state: 'confused'
        };
    }

    const roundedMinutes = Math.round(totalMinutes);
    if (Math.abs(totalMinutes - roundedMinutes) > 1e-6 || roundedMinutes % 30 !== 0) {
        return {
            reply: 'Çalışma süresi yalnızca 30 dakikalık adımlarla girilebilir (örneğin 6 saat veya 6,5 saat).',
            state: 'confused'
        };
    }

    const label = `${formatHoursLabel(roundedMinutes)} · ${PEOPLE_DISPLAY_NAMES[personKey]} · bugün`;
    return {
        reply: `${label} için çalışma saati önerisi hazırlandı. Kaydetmek için onaylayın.`,
        state: 'understood',
        action: {
            type: 'workHours.propose',
            person: personKey,
            minutes: roundedMinutes,
            label
        }
    };
}

function matchOfficeDocuments(documentId, query) {
    if (documentId) {
        const exact = OFFICE_DOCUMENTS.find((doc) => doc.id === documentId);
        if (exact) return [exact];
    }

    const searchText = normalizeTurkishText(query || documentId || '');
    if (!searchText) return [];

    // 1. Exact title match.
    const exactTitle = OFFICE_DOCUMENTS.filter((doc) => normalizeTurkishText(doc.title) === searchText);
    if (exactTitle.length > 0) return exactTitle;

    // 2. Token-based matching against title, id, and tags.
    const tokens = searchText.split(/\s+/).filter((token) => token.length >= 2);
    if (tokens.length === 0) return [];

    const matches = OFFICE_DOCUMENTS.filter((doc) => {
        const haystack = normalizeTurkishText([doc.id.replace(/-/g, ' '), doc.title, ...(doc.tags || [])].join(' '));
        return tokens.every((token) => haystack.includes(token));
    });

    if (matches.length > 0) return matches;

    // 3. Fallback: match any document whose title or tags share the most specific token (when single token failed due to suffix like "dilekcesi").
    const stemmedMatches = OFFICE_DOCUMENTS.filter((doc) => {
        const haystack = normalizeTurkishText([doc.id.replace(/-/g, ' '), doc.title, ...(doc.tags || [])].join(' '));
        return tokens.every((token) => {
            const stem = token.length > 5 ? token.slice(0, 5) : token;
            return haystack.includes(token) || haystack.includes(stem);
        });
    });

    return stemmedMatches;
}

async function runProposeDocumentsPrint(args, context) {
    await resolveStaffForTool(context);

    const copies = args.copies === undefined ? 1 : args.copies;
    if (!Number.isInteger(copies) || copies < 1 || copies > STAFF_ASSISTANT_MAX_COPIES) {
        return {
            reply: `Kopya sayısı 1 ile ${STAFF_ASSISTANT_MAX_COPIES} arasında bir tam sayı olmalıdır. Kaç kopya çıkarayım?`,
            state: 'confused'
        };
    }

    const matches = matchOfficeDocuments(args.documentId, args.query);
    if (matches.length === 0) {
        const available = OFFICE_DOCUMENTS.map((doc) => doc.title).join(', ');
        return {
            reply: `İstenen belge bulunamadı. Mevcut belgeler: ${available}.`,
            state: 'confused'
        };
    }

    if (matches.length > 1) {
        const options = matches.map((doc) => doc.title).join(', ');
        return {
            reply: `Birden fazla belge eşleşti; hangisini çıkarayım? ${options}`,
            state: 'confused'
        };
    }

    const selected = matches[0];
    return {
        reply: `${selected.title} için ${copies} kopya yazdırma hazırlandı.`,
        state: 'understood',
        action: {
            type: 'documents.print',
            documentId: selected.id,
            copies
        }
    };
}

async function runYknFlow(args, context) {
    await resolveStaffForTool(context);
    const passportNo = args.passportNo.trim().toUpperCase();
    if (!PASSPORT_NO_PATTERN.test(passportNo)) {
        return {
            reply: 'Geçerli bir pasaport numarası girin (5–20 karakter, yalnızca harf ve rakam).',
            state: 'confused'
        };
    }
    return {
        reply: `${passportNo} pasaport numarası için YKN zinciri başlatılıyor. Topi bilgileri aktarsa da YÖKSİS'te Kaydet tuşuna basmaz ve Apply'a talep göndermez.`,
        state: 'understood',
        action: { type: 'ykn.run', passportNo }
    };
}

async function runSearchTebligat(args, context) {
    await resolveStaffForTool(context);
    const query = args.query.trim();
    if (query.length < 2 || query.length > 80) {
        return {
            reply: 'Tebligat araması için 2 ile 80 karakter arasında bir ad veya numara yazın.',
            state: 'confused'
        };
    }

    return {
        reply: `"${query}" için tebliğ kayıtlarına bakıyorum.`,
        state: 'understood',
        action: { type: 'tebligat.lookup', query }
    };
}

async function runNavigate(args, context) {
    await resolveStaffForTool(context);
    return {
        reply: `${VIEW_LABELS[args.view]} ekranı açılıyor.`,
        state: 'understood',
        action: { type: 'navigate', view: args.view }
    };
}

/**
 * Executes one validated staff assistant tool with per-tool role enforcement.
 * @param {string} name Tool name from `STAFF_ASSISTANT_TOOLS`.
 * @param {object} args Raw tool arguments.
 * @param {{ environment: object, request: Request, staff?: object }} context Execution context.
 * @returns {Promise<{ reply?: string, state?: string, action?: object, results?: object, ask?: string }>} Deterministic tool result.
 */
export async function runStaffAssistantTool(name, args, context) {
    const validatedArgs = validateStaffToolArgs(name, args);
    switch (name) {
    case 'search_applications':
        return runSearchApplications(validatedArgs, context);
    case 'lookup_yoksis_audit':
        return runLookupYoksisAudit(validatedArgs, context);
    case 'propose_work_hours':
        return runProposeWorkHours(validatedArgs, context);
    case 'propose_documents_print':
        return runProposeDocumentsPrint(validatedArgs, context);
    case 'run_ykn_flow':
        return runYknFlow(validatedArgs, context);
    case 'search_tebligat':
        return runSearchTebligat(validatedArgs, context);
    case 'navigate':
        return runNavigate(validatedArgs, context);
    default:
        throw new Error('invalid-tool-args');
    }
}
