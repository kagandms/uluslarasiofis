import { PHYSICAL_RECEIPT_MESSAGES } from './i18n/physical-receipt-messages.js';

function appendText(parent,tag,value) {
    const node=parent.ownerDocument.createElement(tag); node.textContent=value; parent.append(node); return node;
}

/** Mounts code tracking separately so an online owner session cannot hide it. @param {Document} document Owner.
 * @returns {HTMLElement} Persistent accessible tracking form. */
export function createPhysicalTrackingPanel(document) {
    const panel=document.createElement('section'); panel.className='tracking-state physical-tracking-panel';
    const state={reference:'',payload:null,messageKey:null,isBusy:false};
    const render=()=>renderPanel(panel,state,submit);
    async function submit(reference) {
        if (state.isBusy) return;
        state.reference=reference; state.isBusy=true; state.messageKey=null; render();
        try {
            const response=await fetch('/api/public/physical-intakes/tracking-lookup',{method:'POST',credentials:'same-origin',
                headers:{'Content-Type':'application/json'},body:JSON.stringify({tracking_reference:reference})});
            const payload=await response.json();
            if (!response.ok) { state.payload=null; state.messageKey=response.status===429?'rateLimited':'error'; }
            else {state.payload=payload.found?payload:null;state.messageKey=payload.found?null:'notFound';}
        } catch (error) {
            console.error('Physical tracking request failed.',{errorName:error.name});state.payload=null;state.messageKey='error';
        } finally {state.isBusy=false;render();}
    }
    document.addEventListener('public:locale-changed',render); render(); return panel;
}

function renderPanel(panel,state,submit) {
    const locale=panel.ownerDocument.documentElement.lang || 'tr';
    const messages=PHYSICAL_RECEIPT_MESSAGES[locale] || PHYSICAL_RECEIPT_MESSAGES.tr;
    panel.replaceChildren(); appendText(panel,'h2',messages.heading);appendText(panel,'p',messages.explanation);
    const form=panel.ownerDocument.createElement('form'); form.className='physical-tracking-form';
    const label=appendText(form,'label',messages.label);label.htmlFor='physical-tracking-reference';
    const input=panel.ownerDocument.createElement('input');input.id='physical-tracking-reference';input.name='tracking_reference';
    input.className='glass-input';input.dir='ltr';input.required=true;input.maxLength=64;input.value=state.reference;input.placeholder='ITU-YY-XXXXXXX';
    input.autocomplete='off';input.disabled=state.isBusy;label.append(input);
    const button=appendText(form,'button',messages.submit);button.type='submit';button.className='application-button application-button-primary';button.disabled=state.isBusy;
    form.addEventListener('submit',event=>{event.preventDefault();submit(input.value);});panel.append(form);
    const notice=appendText(panel,'p',state.messageKey?messages[state.messageKey]:'');notice.setAttribute('role','status');
    if (state.payload) {
        appendText(panel,'p',state.payload.tracking_reference).dir='ltr';
        appendText(panel,'p',messages[state.payload.office_status] || messages.error);
        if (typeof state.payload.rejection_reason === 'string' && state.payload.rejection_reason.trim()) {
            appendText(panel,'strong',messages.rejectionReasonLabel);
            appendText(panel,'p',state.payload.rejection_reason);
        }
        appendText(panel,'p',state.payload.application_date);
        appendText(panel,'time',state.payload.updated_at).dateTime=state.payload.updated_at;
    }
}
