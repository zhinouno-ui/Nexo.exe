self.onmessage = (event) => {
  const { text = '', fileName = '' } = event.data || {};

  const normalizePhoneNumber = (phone = '') => String(phone).replace(/\D/g, '');
  const normalizeHeader = (h = '') => String(h).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const parseCSVRow = (line = '', delimiter = ',') => {
    const row = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === delimiter && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else current += c;
    }
    row.push(current.trim());
    return row.map((v) => v.replace(/^"|"$/g, '').trim());
  };

  const parseBackupJson = (rawText) => {
    const parsed = JSON.parse(rawText);
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.contacts) ? parsed.contacts : null);
    if (!list) throw new Error('El JSON no contiene una lista válida');
    return list.map((c) => ({
      name: (c?.name || '').toString().trim(),
      phone: normalizePhoneNumber(c?.phone || ''),
      status: c?.status || 'sin revisar',
      origin: (c?.origin || 'Backup JSON').toString().trim()
    })).filter((c) => c.name || c.phone);
  };

  const parseCsvContacts = (rawText) => {
    const detectDelimiter = (headerLine) => {
      const candidates = [',', ';', '\t', '|'];
      let best = ',';
      let bestScore = -1;
      candidates.forEach((candidate) => {
        const score = parseCSVRow(headerLine, candidate).length;
        if (score > bestScore) { best = candidate; bestScore = score; }
      });
      return best;
    };

    const isNameHeader = (header) => ['name','nombre','usuario','fullname','full name','displayname','display name','contacto','contact'].includes(header) || header.includes('nombre') || header.includes('usuario') || header.includes('name');
    const isPhoneHeader = (header) => ['number','phone','telefono','tel','cel','celular','mobile','movil','whatsapp','msisdn'].includes(header) || header.includes('telefono') || header.includes('numero') || header.includes('phone') || header.includes('mobile') || header.includes('whatsapp');
    const mapStatus = (value) => {
      const v = String(value || '').toLowerCase();
      if (v.includes('promo enviada') || v.includes('contactado')) return 'contactado';
      if (v.includes('no esta en wsp') || v.includes('sin wsp')) return 'sin wsp';
      if (v.includes('en contacto') || v.includes('jugando')) return 'jugando';
      if (v.includes('eliminado') || v.includes('no interesado')) return 'no interesado';
      if (v.includes('revisado') || v.includes('verificado')) return 'revisado';
      if (v.includes('a contactar') || v.includes('sin revisar')) return 'sin revisar';
      return undefined;
    };

    const lines = rawText.replace(/\r/g, '').split('\n').filter((line) => line.trim());
    if (!lines.length) return [];
    const delimiter = detectDelimiter(lines[0]);
    const headers = parseCSVRow(lines[0], delimiter).map(normalizeHeader);
    const contacts = [];
    const total = lines.length;

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVRow(lines[i], delimiter);
      const contact = {};
      headers.forEach((header, index) => {
        const value = values[index] || '';
        if (!value) return;
        if (isNameHeader(header)) contact.name = value;
        else if (isPhoneHeader(header)) contact.phone = normalizePhoneNumber(value);
        else if (header.includes('estado') && !header.includes('revision')) {
          const status = mapStatus(value);
          if (status) contact.status = status;
        }
      });
      if (!contact.phone) {
        const probablePhone = values.find((v) => /\d{6,}/.test((v || '').replace(/\D/g, '')));
        if (probablePhone) contact.phone = normalizePhoneNumber(probablePhone);
      }
      if (!contact.name && contact.phone) contact.name = contact.phone;
      if (contact.name || contact.phone) contacts.push(contact);
      if (i % 400 === 0) self.postMessage({ type: 'progress', processed: i, total });
    }

    return contacts;
  };

  try {
    const lower = String(fileName || '').toLowerCase();
    const contacts = lower.endsWith('.json') ? parseBackupJson(text) : parseCsvContacts(text);
    self.postMessage({ type: 'done', contacts });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
