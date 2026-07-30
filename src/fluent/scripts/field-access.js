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
    choiceGr.orderBy('sequence');
    choiceGr.query();
    while (choiceGr.next()) {
      choices.push({
        value: String(choiceGr.getValue('value')),
        label: String(choiceGr.getValue('label')),
      });
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

  function entryFromGlideElement(ge, tableName, name) {
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
    if (internalType === 'choice') {
      entry.choices = getChoicesForField(tableName, name);
    }
    return entry;
  }

  function resolveFieldAccess(tableName, name) {
    var ge = gr.getElement(name);
    var entry = entryFromGlideElement(ge, tableName, name);
    if (entry) return entry;

    var dict = lookupDictionary(tableName, name);
    if (!dict) return null;

    ge = gr.getElement(name);
    entry = entryFromGlideElement(ge, tableName, name);
    if (entry) return entry;

    var dictType = String(dict.getValue('internal_type') || 'string');
    var dictEntry = {
      read: ge.canRead(),
      write: ge.canWrite(),
      internal_type: dictType,
      reference: String(dict.getValue('reference') || ''),
      max_length: parseInt(dict.getValue('max_length'), 10) || 0,
    };
    if (dictType === 'choice') {
      dictEntry.choices = getChoicesForField(tableName, name);
    }
    return dictEntry;
  }

  var canWriteRecord = gr.canWrite();
  var fields = {};
  var fieldNames = String(fieldsParam).split(',');

  for (var i = 0; i < fieldNames.length; i++) {
    var name = fieldNames[i].replace(/^\s+|\s+$/g, '');
    if (!name) continue;

    var entry = resolveFieldAccess(table, name);
    if (!entry || !entry.read) continue;

    fields[name] = entry;
  }

  response.setContentType('application/json');
  response.setBody({
    canWriteRecord: canWriteRecord,
    fields: fields,
  });
})(request, response);
