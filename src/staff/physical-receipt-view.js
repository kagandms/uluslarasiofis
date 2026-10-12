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
    for (const [name,label] of [['application_date','Başvuru / Teslim Tarihi'],['first_name','Ad'],['last_name','Soyad'],['passport_number','Pasaport No'],['student_number','Öğrenci No (isteğe bağlı)']]) appendMetadataField(form,{...options,name,label});
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
    appendButton(panel,'Listeye Dön',handlers.back); appendText(panel,'h3','Öğrenci Bilgileri');
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

function renderDocumentLinks(panel,intake,receipts) {
    for (const receipt of receipts) {
        const isStale=receipt.metadata_version!==intake.metadata_version;
        appendText(panel,'p',`A4 v${receipt.document_version} · ${receipt.state}${isStale?' · Bilgiler değişti; bu A4 güncel değil.':''}`);
        if (receipt.state==='ready') {
            const link=appendText(panel,'a',`A4 v${receipt.document_version} PDF İndir`);
            link.href=`/api/staff/physical-intakes/${intake.id}/receipts/${receipt.id}?download=1`;
            link.target='_blank'; link.rel='noopener'; link.className='btn btn-outline';
        }
    }
}

/** Renders metadata, office closure and persistent print controls. @param {HTMLElement} panel Mount. @param {object} state Detail. @param {object} handlers Actions. @returns {void} Render. */
export function renderPhysicalReceiptControls(panel,state,handlers) {
    const intake=state.detail.intake;
    appendText(panel,'p',`Takip No: ${intake.tracking_reference || '—'} · Teslim Tarihi: ${intake.application_date || '—'}`);
    if (!intake.deleted_at && !intake.processing_closed_at && intake.legacy_status!=='completed') {
        if (intake.tracking_reference) appendButton(panel,'Bilgileri Düzenle',handlers.editMetadata);
        appendButton(panel,'Ofis İşlemini Kapat',()=>handlers.processing('close'));
    }
    if (intake.processing_closed_at || intake.legacy_status==='completed') {
        appendText(panel,'p',`Ofis işlemi kapalı: ${intake.processing_closure_reason || '—'}. Bu, ikamet izni onayı değildir.`);
        if (state.receiptConfig?.staff_role==='admin' && !intake.deleted_at) appendButton(panel,'Ofis İşlemini Yeniden Aç',()=>handlers.processing('reopen'));
    }
    if (state.isEditingMetadata) renderMetadataEdit(panel,state,handlers);
    if (!intake.tracking_reference || intake.deleted_at) return;
    appendButton(panel,'A4 Hazırla',handlers.prepareReceipt);
    renderDocumentLinks(panel,intake,state.detail.receipts || []);
    const attempts=state.printAttempts || [];
    appendButton(panel,attempts.length?'A4 Yeniden Yazdır':'A4 Yazdır',()=>handlers.printReceipt(attempts.length?'reprint':'print'));
    appendButton(panel,'Manuel Yazdır',()=>handlers.printReceipt('manual'));
    for (const attempt of attempts) {
        appendText(panel,'p',`Baskı: ${attempt.status}${attempt.blocks_new_attempt?' · Yeni baskı kilitli.':''}`);
        if (attempt.status==='uploading') appendButton(panel,'Devam Et',()=>handlers.printAction(attempt.id,'resume'));
        if (['uploading','queued'].includes(attempt.status)) appendButton(panel,'Baskıyı Güvenle İptal Et',()=>handlers.printAction(attempt.id,'cancel'));
    }
}
