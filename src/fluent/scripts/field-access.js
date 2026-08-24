(function process(request, response) {
  function jsonError(status, message) {
    response.setStatus(status);
    response.setContentType('application/json');
    response.setBody({ error: message });
  }

  var table = request.queryParams.table.toString();
  var sysId = request.queryParams.sys_id.toString();
  var fieldsParam = request.queryParams.fields.toString();

  if (!table || !sysId || !fieldsParam) {
    jsonError(400, 'Missing required query parameter: table, sys_id, or fields');
    return;
  }

  var gr = new GlideRecord(table);
  if (!gr.get(sysId)) {
    jsonError(404, 'Record not found');
    return;
  }

  function getParentTable(tableName) {
    var db = new GlideRecord('sys_db_object');
    db.addQuery('name', tableName);
    db.setLimit(1);
    db.query();
    if (!db.next()) return '';
    if (db.super_class.nil && db.super_class.nil()) return '';
    if (!db.super_class) return '';
    return String(db.super_class.name || '');
  }

  function lookupDictionary(tableName, elementName) {
    var current = tableName;
    var seen = {};
    for (var i = 0; i < 12; i++) {
      if (!current || seen[current]) break;
      seen[current] = true;

      var dict = new GlideRecord('sys_dictionary');
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
    var choices = [];
    var choiceGr = new GlideRecord('sys_choice');
    choiceGr.addQuery('name', tableName);
    choiceGr.addQuery('element', element);
    choiceGr.addQuery('inactive', false);
    choiceGr.addQuery('language', 'en');
    choiceGr.orderBy('sequence');
    choiceGr.query();
    while (choiceGr.next()) {
      var value = String(choiceGr.getValue('value') || '');
      var label = String(choiceGr.getValue('label') || value);
      if (!value) continue;
      choices.push({ value: value, label: label });
    }
    return choices;
  }

  function getChoicesForField(tableName, element) {
    var current = tableName;
    var seen = {};
    for (var i = 0; i < 12; i++) {
      if (!current || seen[current]) break;
      seen[current] = true;
      var choices = getChoices(current, element);
      if (choices.length) return choices;
      current = getParentTable(current);
    }
    return [];
  }

  function isNoneChoice(choice) {
    if (choice === null || choice === undefined || choice === '') return true;
    var normalized = String(choice).replace(/^\s+|\s+$/g, '').toUpperCase();
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
      var choices = getChoicesForField(tableName, name);
      if (choices.length) entry.choices = choices;
    } catch (e) {
      // Choice metadata must never break field_access (canWriteRecord probe).
    }
    return entry;
  }

  function parseMandatoryValue(value) {
    if (value === true || value === 1) return true;
    var normalized = String(value == null ? '' : value).replace(/^\s+|\s+$/g, '').toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  function isMandatoryFromElement(ed) {
    if (!ed) return false;
    try {
      if (typeof ed.isMandatory === 'function' && ed.isMandatory()) return true;
    } catch (e) {
      // Fall back to dictionary below.
    }
    return false;
  }

  function isMandatoryFromDictionary(dict) {
    if (!dict) return false;
    try {
      if (parseMandatoryValue(dict.getValue('mandatory'))) return true;
      if (parseMandatoryValue(dict.mandatory)) return true;
    } catch (e) {
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
    var ed = ge.getED();
    if (!ed) return null;

    var internalType = String(ed.getInternalType());
    var entry = {
      read: ge.canRead(),
      write: ge.canWrite(),
      internal_type: internalType,
      reference: String(ed.getReference() || ''),
      max_length: ed.getLength(),
    };
    return attachFieldMeta(entry, tableName, name, internalType, dict, ed);
  }

  function resolveFieldAccess(tableName, name) {
    var dict = lookupDictionary(tableName, name);
    var ge = gr.getElement(name);
    var entry = entryFromGlideElement(ge, tableName, name, dict);
    if (entry) return entry;

    if (!dict) return null;

    ge = gr.getElement(name);
    entry = entryFromGlideElement(ge, tableName, name, dict);
    if (entry) return entry;

    var dictType = String(dict.getValue('internal_type') || 'string');
    var dictEd = ge.getED();
    var dictEntry = {
      read: ge.canRead(),
      write: ge.canWrite(),
      internal_type: dictType,
      reference: String(dict.getValue('reference') || ''),
      max_length: parseInt(dict.getValue('max_length'), 10) || 0,
    };
    return attachFieldMeta(dictEntry, tableName, name, dictType, dict, dictEd);
  }

  var canWriteRecord = gr.canWrite();
  var fields = {};
  var fieldNames = String(fieldsParam).split(',');

  for (var i = 0; i < fieldNames.length; i++) {
    var name = fieldNames[i].replace(/^\s+|\s+$/g, '');
    if (!name) continue;

    try {
      var entry = resolveFieldAccess(table, name);
      if (!entry || !entry.read) continue;
      fields[name] = entry;
    } catch (e) {
      // Skip unreadable/broken fields; keep canWriteRecord response intact.
    }
  }

  response.setContentType('application/json');
  response.setBody({
    canWriteRecord: canWriteRecord,
    fields: fields,
  });
})(request, response);
