(function process(request, response) {
  function jsonError(status, message) {
    response.setStatus(status);
    response.setContentType('application/json');
    response.setBody({ error: message });
  }

  const table = request.queryParams.table.toString();
  const sysId = request.queryParams.sys_id.toString();
  const fieldsParam = request.queryParams.fields.toString();

  if (!table || !sysId || !fieldsParam) {
    jsonError(400, 'Missing required query parameter: table, sys_id, or fields');
    return;
  }

  const gr = new GlideRecord(table);
  if (!gr.get(sysId)) {
    jsonError(404, 'Record not found');
    return;
  }

  function getParentTable(tableName) {
    const db = new GlideRecord('sys_db_object');
    db.addQuery('name', tableName);
    db.setLimit(1);
    db.query();
    if (!db.next()) return '';
    if (db.super_class.nil?.()) return '';
    if (!db.super_class) return '';
    return String(db.super_class.name || '');
  }

  function lookupDictionary(tableName, elementName) {
    let current = tableName;
    const seen = {};
    for (let i = 0; i < 12; i++) {
      if (!current || seen[current]) break;
      seen[current] = true;

      const dict = new GlideRecord('sys_dictionary');
      dict.addQuery('name', current);
      dict.addQuery('element', elementName);
      dict.addQuery('active', true);
      dict.setLimit(1);
      dict.query();
      if (dict.next()) return dict;

      current = getParentTable(current);
    }
    return null;
  }

  function getChoices(tableName, element) {
    const choices = [];
    const choiceGr = new GlideRecord('sys_choice');
    choiceGr.addQuery('name', tableName);
    choiceGr.addQuery('element', element);
    choiceGr.addQuery('inactive', false);
    choiceGr.addQuery('language', 'en');
    choiceGr.orderBy('sequence');
    choiceGr.query();
    while (choiceGr.next()) {
      const value = String(choiceGr.getValue('value') || '');
      const label = String(choiceGr.getValue('label') || value);
      if (!value) continue;
      choices.push({ value: value, label: label });
    }
    return choices;
  }

  function getChoicesForField(tableName, element) {
    let current = tableName;
    const seen = {};
    for (let i = 0; i < 12; i++) {
      if (!current || seen[current]) break;
      seen[current] = true;
      const choices = getChoices(current, element);
      if (choices.length) return choices;
      current = getParentTable(current);
    }
    return [];
  }

  function isNoneChoice(choice) {
    if (choice === null || choice === undefined || choice === '') return true;
    const normalized = String(choice).trim().toUpperCase();
    return normalized === '0' || normalized === 'NONE';
  }

  function shouldLoadChoices(internalType, dict) {
    if (String(internalType) === 'choice') return true;
    if (!dict) return false;
    if (String(dict.getValue('internal_type') || 'string') === 'choice') return true;
    return !isNoneChoice(dict.getValue('choice'));
  }

  function attachChoicesSafely(entry, tableName, name, internalType, dict) {
    try {
      if (!shouldLoadChoices(internalType, dict)) return entry;
      const choices = getChoicesForField(tableName, name);
      if (choices.length) entry.choices = choices;
    } catch (error) {
      // Choice metadata must never break field_access (canWriteRecord probe).
      gs.debug('field-access attachChoices failed for ' + tableName + '.' + name + ': ' + error);
    }
    return entry;
  }

  function parseMandatoryValue(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value == null ? '' : value).trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  function isMandatoryFromElement(ed) {
    if (!ed) return false;
    try {
      if (typeof ed.isMandatory === 'function' && ed.isMandatory()) return true;
    } catch (error) {
      // Fall back to dictionary below.
      gs.debug('field-access isMandatoryFromElement probe failed: ' + error);
    }
    return false;
  }

  function isMandatoryFromDictionary(dict) {
    if (!dict) return false;
    try {
      if (parseMandatoryValue(dict.getValue('mandatory'))) return true;
      if (parseMandatoryValue(dict.mandatory)) return true;
    } catch (error) {
      gs.debug('field-access isMandatoryFromDictionary probe failed: ' + error);
      return false;
    }
    return false;
  }

  function isMandatoryField(dict, ed) {
    return isMandatoryFromElement(ed) || isMandatoryFromDictionary(dict);
  }

  function attachFieldMeta(entry, tableName, name, internalType, dict, ed) {
    entry.mandatory = isMandatoryField(dict, ed);
    return attachChoicesSafely(entry, tableName, name, internalType, dict);
  }

  function entryFromGlideElement(ge, tableName, name, dict) {
    const ed = ge.getED();
    if (!ed) return null;

    const internalType = String(ed.getInternalType());
    const entry = {
      read: ge.canRead(),
      write: ge.canWrite(),
      internal_type: internalType,
      reference: String(ed.getReference() || ''),
      max_length: ed.getLength(),
    };
    return attachFieldMeta(entry, tableName, name, internalType, dict, ed);
  }

  function resolveFieldAccess(tableName, name) {
    const dict = lookupDictionary(tableName, name);
    let ge = gr.getElement(name);
    let entry = entryFromGlideElement(ge, tableName, name, dict);
    if (entry) return entry;

    if (!dict) return null;

    ge = gr.getElement(name);
    entry = entryFromGlideElement(ge, tableName, name, dict);
    if (entry) return entry;

    const dictType = String(dict.getValue('internal_type') || 'string');
    const dictEd = ge.getED();
    const dictEntry = {
      read: ge.canRead(),
      write: ge.canWrite(),
      internal_type: dictType,
      reference: String(dict.getValue('reference') || ''),
      max_length: Number.parseInt(dict.getValue('max_length'), 10) || 0,
    };
    return attachFieldMeta(dictEntry, tableName, name, dictType, dict, dictEd);
  }

  const canWriteRecord = gr.canWrite();
  const fields = {};
  const fieldNames = String(fieldsParam).split(',');

  for (const fieldName of fieldNames) {
    const name = fieldName.trim();
    if (!name) continue;

    try {
      const entry = resolveFieldAccess(table, name);
      if (!entry?.read) continue;
      fields[name] = entry;
    } catch (error) {
      // Skip unreadable/broken fields; keep canWriteRecord response intact.
      gs.debug('field-access resolveFieldAccess failed for ' + name + ': ' + error);
    }
  }

  response.setContentType('application/json');
  response.setBody({
    canWriteRecord: canWriteRecord,
    fields: fields,
  });
})(request, response);
