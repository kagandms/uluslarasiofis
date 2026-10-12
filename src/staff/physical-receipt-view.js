function appendText(parent,tag,value) {
    const node=parent.ownerDocument.createElement(tag); node.textContent=value; parent.append(node); return node;
}

function appendButton(parent,label,run) {
    const button=appendText(parent,'button',label); button.type='button'; button.className='btn btn-outline'; button.addEventListener('click',run); return button;
}

function appendMetadataField(form,options) {
    const input=form.ownerDocument.createElement('input');
    input.id=`receipt-${options.name}`; input.name=options.name; input.className='glass-input';
    input.value=options.draft[options.name] || ''; input.type=options.name==='application_date'?'date':'text';
    input.maxLength=options.name.includes('name')?120:64; input.required=options.name!=='student_number';
    input.disabled=Boolean(options.isLocked);
    appendText(form,'label',options.label).htmlFor=input.id;
    input.addEventListener('input',()=>{ options.draft[options.name]=input.value; options.onChange?.(); });
    form.append(input);
}

function appendMetadataFields(form,options) {
    for (const [name,label] of [['application_date','Başvuru / Teslim Tarihi'],['first_name','Ad'],['last_name','Soyad'],['passport_number','Pasaport No']]) appendMetadataField(form,{...options,name,label});
    const type=form.ownerDocument.createElement('select'); type.id='receipt-application-type'; type.required=true; type.className='glass-input';
    for (const [value,label] of [['','Başvuru türünü seçin'],['initial','İlk başvuru'],['renewal','Uzatma']]) {
        const option=appendText(type,'option',label); option.value=value;
    }
    type.value=options.draft.application_type; type.disabled=Boolean(options.isLocked);
    appendText(form,'label','Başvuru Türü').htmlFor=type.id;
    type.addEventListener('change',()=>{options.draft.application_type=type.value;}); form.append(type);
}

/** Renders the information-first form. @param {HTMLElement} panel Mount. @param {object} state Draft. @param {object} handlers Actions. @returns {void} Render. */
export function renderPhysicalReceiptDraft(panel,state,handlers) {
    appendButton(panel,'Kapat',handlers.back);
    const heading=appendText(panel,'h3','Öğrenci Bilgileri'); heading.id='physical-receipt-dialog-title';
    const form=panel.ownerDocument.createElement('form'); form.className='physical-intake-form';
    const warning=panel.ownerDocument.createElement('p'); warning.setAttribute('role','status');
    const reference=panel.ownerDocument.createElement('p'); reference.dir='ltr';
    const refreshWarning=()=>{
        const isFuture=state.draft.application_date>state.receiptConfig.today;
        const hasYearChanged=state.reservation && state.draft.application_date.slice(0,4)!==state.reservation.application_date.slice(0,4);
        warning.textContent=hasYearChanged?'Tarih yılı değişti. Başvuru No Ata’ya tekrar basın.':isFuture?'İleri bir teslim tarihi seçtiniz. Tarihi kontrol edin.':'';
    };
    appendMetadataFields(form,{draft:state.draft,isLocked:Boolean(state.registrationBody),onChange:refreshWarning});
    const assign=appendButton(form,'Başvuru No Ata',handlers.assignReference); assign.disabled=Boolean(state.registrationBody);
    reference.textContent=state.reservation?`Başvuru Takip No: ${state.reservation.tracking_reference}`:'Henüz numara ayrılmadı.';
    form.append(reference,warning); refreshWarning();
    const save=appendButton(form,state.registrationBody?'Aynı Kaydı Kontrol Et / Devam Et':'Oluştur ve Yazdır',()=>{});
    save.type='submit'; save.className='btn btn-primary'; save.disabled=!state.reservation;
    form.addEventListener('submit',event=>{event.preventDefault();handlers.create();}); panel.append(form);
    if (state.duplicateMatches?.length) {
        appendText(panel,'p','Aktif kayıtlar bulundu. Birini açın; otomatik birleştirme yapılmaz.');
        for (const intake of state.duplicateMatches) appendButton(panel,`${intake.first_name} ${intake.last_name} · ${intake.tracking_reference || 'Eski kayıt'}`,()=>handlers.open(intake.id));
    }
}

function renderMetadataEdit(panel,state,handlers) {
    const form=panel.ownerDocument.createElement('form'); form.className='physical-intake-form';
    const warning=appendText(form,'p',''); warning.setAttribute('role','status');
    const refreshWarning=()=>{ warning.textContent=state.metadataDraft.application_date>state.receiptConfig.today?'İleri bir teslim tarihi seçtiniz. Tarihi kontrol edin.':''; };
    appendMetadataFields(form,{draft:state.metadataDraft,onChange:refreshWarning}); refreshWarning();
    const save=appendButton(form,'Bilgileri Kaydet',()=>{}); save.type='submit';
    form.addEventListener('submit',event=>{event.preventDefault();handlers.saveMetadata(state.metadataDraft);}); panel.append(form);
}

/** Renders only metadata editing and a compact download action.
 * @param {HTMLElement} panel Mount. @param {object} state Detail. @param {object} handlers Actions.
 * @returns {void} Appends the receipt actions without print/closure controls.
 */
export function renderPhysicalReceiptControls(panel,state,handlers) {
    const intake=state.detail.intake;
    appendText(panel,'p',`Takip No: ${intake.tracking_reference || '—'} · Teslim Tarihi: ${intake.application_date || '—'}`);
    if (!intake.deleted_at && !intake.processing_closed_at && intake.legacy_status!=='completed' && intake.status!=='completed') {
        if (intake.tracking_reference) appendButton(panel,'Bilgileri Düzenle',handlers.editMetadata);
    }
    if (state.isEditingMetadata) renderMetadataEdit(panel,state,handlers);
    if (!intake.tracking_reference || intake.deleted_at) return;
    const actions=panel.ownerDocument.createElement('div'); actions.className='physical-receipt-actions';
    const download=appendButton(actions,'A4 İndir',handlers.downloadReceipt);
    download.classList.add('physical-receipt-download');
    panel.append(actions);
}
