import { PHYSICAL_RECEIPT_MESSAGES } from '../public/i18n/physical-receipt-messages.js';

const LANGUAGE_NAMES={tr:'Türkçe',en:'English',ru:'Русский',tk:'Türkmençe',ar:'العربية'};
const FIELDS=[['first_name','Ad / First name'],['last_name','Soyad / Last name'],['passport_number','Pasaport No / Passport No'],['application_date','Başvuru-Teslim Tarihi / Submission date']];

function appendText(parent,tag,value) {
    const node=parent.ownerDocument.createElement(tag);
    node.textContent=value;
    parent.append(node);
    return node;
}

/** Creates accessible receipt HTML without interpolating personal fields. @param {Document} document Owner. @param {object} snapshot Persisted snapshot. @param {object} logos Loaded logo data URLs.
 * @returns {HTMLElement} Fixed A4 canvas source. @throws {Error} Missing origin/identity. */
export function createPhysicalReceiptTemplate(document,snapshot,logos) {
    if (!snapshot.portal_origin || !snapshot.tracking_reference) throw new Error('Takip numarası ve doğrulanmış portal adresi gerekli.');
    const root=document.createElement('article');
    root.className='physical-receipt-sheet';
    root.lang='tr'; root.dir='ltr';
    const header=document.createElement('header');
    for (const [key,label] of [['university','İstanbul Topkapı Üniversitesi'],['migration','Göç İdaresi']]) {
        const image=document.createElement('img');
        image.src=logos[key]; image.alt=label;
        header.append(image);
    }
    root.append(header);
    appendText(root,'h1','İkamet Başvurusu — Teslim ve Takip Bilgileri');
    const fields=document.createElement('dl');
    for (const [key,label] of FIELDS) { appendText(fields,'dt',label); appendText(fields,'dd',snapshot[key]); }
    root.append(fields);
    appendText(root,'h2','Başvuru Takip No / Tracking No');
    const code=appendText(root,'p',snapshot.tracking_reference); code.className='physical-receipt-code'; code.dir='ltr';
    appendText(root,'p',snapshot.portal_origin).className='physical-receipt-origin';
    for (const [locale,messages] of Object.entries(PHYSICAL_RECEIPT_MESSAGES)) {
        const section=document.createElement('section'); section.lang=locale; section.dir=locale==='ar'?'rtl':'ltr';
        appendText(section,'h3',LANGUAGE_NAMES[locale]);
        appendText(section,'p',messages.instructions.map((instruction,index)=>`${locale==='ar'?['١','٢','٣'][index]:index+1}. ${instruction}`).join(' '));
        root.append(section);
    }
    return root;
}
