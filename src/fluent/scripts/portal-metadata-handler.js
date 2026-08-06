var PortalMetadataHandler = Class.create();
PortalMetadataHandler.prototype = {
  initialize: function () {},

  APP_SCOPE: 'x_citi4_clsa_cmd_0',
  INST_TABLE: 'cmdb_ci_service_auto',
  SVC_TABLE: 'cmdb_ci_service',
  CMDB_CI_TABLE: 'cmdb_ci',

  CHOICE_TABLES: ['cmdb_ci_service_auto', 'cmdb_ci_service', 'cmdb_ci'],

  PROPERTY_NAMES: [
    'x_citi4_clsa_cmd_0.enable.new.app.hierarchy',
    'x_citi4_clsa_cmd_0.ci.filter',
    'x_citi4_clsa_cmd_0.ci.search.filter.table.field',
    'x_citi4_clsa_cmd_0.global.search.filter.table',
    'x_citi4_clsa_cmd_0.global.search.filter.table.field',
    'x_citi4_clsa_cmd_0.global.search.result.field',
    'x_citi4_clsa_cmd_0.app.relationship.depth',
  ],

  ALLOWED_VIEW_TITLES: {
    'CLSA CMDB Workspace': true,
    'CLSA CMDB Workspace Overview': true,
    'CLSA CMDB Workspace Edit': true,
    'CLSA CMDB Workspace Contact': true,
  },

  TIER_FALLBACK: [
    { label: 'Tier 0', value: '0' },
    { label: 'Tier 1', value: '1' },
    { label: 'Tier 2', value: '2' },
    { label: 'Tier 3', value: '3' },
  ],

  jsonError: function (response, status, message) {
    response.setStatus(status);
    response.setContentType('application/json');
    response.setBody({ error: message });
  },

  jsonOk: function (response, body) {
    response.setContentType('application/json');
    response.setBody({ result: body });
  },

  readParam: function (request, name) {
    try {
      if (request.queryParams && request.queryParams[name]) {
        return String(request.queryParams[name].toString() || '').trim();
      }
    } catch (e) {}
    return '';
  },

  isAllowedTable: function (tableName) {
    if (!tableName || !/^[a-z0-9_]+$/.test(tableName)) return false;
    return tableName.indexOf('cmdb_') === 0 || tableName === 'task_ci';
  },

  isAllowedViewTitle: function (title) {
    return Boolean(title && this.ALLOWED_VIEW_TITLES[title]);
  },

  getParentTable: function (tableName) {
    var db = new GlideRecord('sys_db_object');
    db.addQuery('name', tableName);
    db.setLimit(1);
    db.query();
    if (!db.next()) return '';
    try {
      if (db.super_class.nil && db.super_class.nil()) return '';
      if (!db.super_class) return '';
      return String(db.super_class.name || '');
    } catch (e) {
      return '';
    }
  },

  getChoices: function (tableName, element) {
    var choices = [];
    var gr = new GlideRecord('sys_choice');
    gr.addQuery('name', tableName);
    gr.addQuery('element', element);
    gr.addQuery('inactive', false);
    gr.addQuery('language', 'en');
    gr.orderBy('sequence');
    gr.query();
    while (gr.next()) {
      var value = String(gr.getValue('value') || '');
      var label = String(gr.getValue('label') || value);
      if (!value) continue;
      choices.push({ value: value, label: label });
    }
    return choices;
  },

  getChoicesForField: function (tableName, element) {
    var current = tableName;
    var seen = {};
    for (var i = 0; i < 12; i++) {
      if (!current || seen[current]) break;
      seen[current] = true;
      var choices = this.getChoices(current, element);
      if (choices.length) return choices;
      current = this.getParentTable(current);
    }
    return [];
  },

  getMergedChoices: function (element, tableNames) {
    var seen = {};
    var out = [];
    for (var t = 0; t < tableNames.length; t++) {
      var choices = this.getChoicesForField(tableNames[t], element);
      for (var i = 0; i < choices.length; i++) {
        var c = choices[i];
        if (seen[c.value]) continue;
        seen[c.value] = true;
        out.push(c);
      }
    }
    return out;
  },

  getPropertyMap: function () {
    var map = {};
    var gr = new GlideRecord('sys_properties');
    gr.addQuery('name', 'IN', this.PROPERTY_NAMES.join(','));
    gr.query();
    while (gr.next()) {
      map[String(gr.getValue('name'))] = String(gr.getValue('value') || '');
    }
    return map;
  },

  getReferenceOptions: function (table, fields, query, labelField) {
    var out = [];
    var gr = new GlideRecord(table);
    if (query) gr.addEncodedQuery(query);
    gr.orderBy(labelField);
    gr.setLimit(100);
    gr.query();
    while (gr.next()) {
      out.push({
        label: String(gr.getValue(labelField) || gr.getDisplayValue(labelField) || gr.getUniqueValue()),
        value: gr.getUniqueValue(),
      });
    }
    return out;
  },

  getDepartmentOptions: function () {
    var out = [];
    var gr = new GlideRecord('cmn_department');
    gr.addQuery('u_it_department', true);
    gr.orderBy('name');
    gr.setLimit(100);
    gr.query();
    while (gr.next()) {
      var desc = String(gr.getValue('description') || '').trim();
      var name = String(gr.getValue('name') || '').trim();
      out.push({
        label: desc || name || gr.getUniqueValue(),
        value: gr.getUniqueValue(),
      });
    }
    return out;
  },

  handleMetadata: function (request, response) {
    var props = this.getPropertyMap();
    var hierarchyVal = (props['x_citi4_clsa_cmd_0.enable.new.app.hierarchy'] || '').toLowerCase();
    var tier = this.getMergedChoices('u_tier', this.CHOICE_TABLES);
    if (!tier.length) tier = this.TIER_FALLBACK;

    this.jsonOk(response, {
      hierarchy_mode: hierarchyVal === 'true',
      properties: props,
      filter_options: {
        environment: this.getMergedChoices('environment', this.CHOICE_TABLES),
        operational_status: this.getMergedChoices('operational_status', this.CHOICE_TABLES),
        u_tier: tier,
      },
      business_units: this.getReferenceOptions('business_unit', ['sys_id', 'name'], '', 'name'),
      departments: this.getDepartmentOptions(),
    });
  },

  queryUiElements: function (encodedQuery, limit) {
    var rows = [];
    var gr = new GlideRecord('sys_ui_element');
    gr.addEncodedQuery(encodedQuery);
    gr.orderBy('position');
    gr.setLimit(limit || 200);
    gr.query();
    while (gr.next()) {
      rows.push({
        element: String(gr.getValue('element') || ''),
        position: parseInt(gr.getValue('position'), 10) || 0,
        type: String(gr.getValue('type') || ''),
      });
    }
    return rows;
  },

  labelFields: function (tableName, fieldNames) {
    if (!fieldNames.length) return [];
    var labelMap = {};
    var doc = new GlideRecord('sys_documentation');
    doc.addQuery('name', tableName);
    doc.addQuery('language', 'en');
    doc.addQuery('element', 'IN', fieldNames.join(','));
    doc.query();
    while (doc.next()) {
      labelMap[String(doc.getValue('element'))] = String(doc.getValue('label') || '');
    }

    var out = [];
    for (var i = 0; i < fieldNames.length; i++) {
      var el = fieldNames[i];
      out.push({
        element: el,
        label: labelMap[el]
          || el.replace(/_/g, ' ').replace(/\./g, ' \u203a ').replace(/\b\w/g, function (c) {
            return c.toUpperCase();
          }),
      });
    }
    return out;
  },

  resolveFormFieldList: function (tableName, viewTitle, defaultLimit) {
    var limit = defaultLimit || 20;
    var steps = [
      'sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + tableName,
    ];
    if (tableName !== this.INST_TABLE) {
      steps.push('sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + this.INST_TABLE);
    }
    if (tableName !== this.SVC_TABLE) {
      steps.push('sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + this.SVC_TABLE);
    }
    steps.push('sys_ui_section.view.name=^sys_ui_section.name=' + tableName);

    for (var s = 0; s < steps.length; s++) {
      var elems = this.queryUiElements(steps[s] + '^ORDERBYposition', s === steps.length - 1 ? limit : 50);
      var names = [];
      for (var i = 0; i < elems.length; i++) {
        var el = elems[i].element;
        if (el && el.indexOf('.') !== 0) names.push(el);
      }
      if (names.length) return this.labelFields(tableName, names);
    }
    return [];
  },

  findListSysId: function (encodedQuery) {
    var gr = new GlideRecord('sys_ui_list');
    gr.addEncodedQuery(encodedQuery);
    gr.setLimit(1);
    gr.query();
    return gr.next() ? gr.getUniqueValue() : '';
  },

  resolveListFieldList: function (tableName, viewTitle) {
    var listId = this.findListSysId('name=' + tableName + '^view.title=' + viewTitle);
    if (listId) {
      var gr = new GlideRecord('sys_ui_list_element');
      gr.addQuery('list_id', listId);
      gr.orderBy('position');
      gr.setLimit(50);
      gr.query();
      var names = [];
      while (gr.next()) {
        var el = String(gr.getValue('element') || '');
        if (el) names.push(el);
      }
      if (names.length) return this.labelFields(tableName, names);
    }

    listId = this.findListSysId('name=' + tableName + '^view.name=');
    if (listId) {
      var gr2 = new GlideRecord('sys_ui_list_element');
      gr2.addQuery('list_id', listId);
      gr2.orderBy('position');
      gr2.setLimit(20);
      gr2.query();
      var names2 = [];
      while (gr2.next()) {
        var el2 = String(gr2.getValue('element') || '');
        if (el2) names2.push(el2);
      }
      if (names2.length) return this.labelFields(tableName, names2);
    }

    var gr3 = new GlideRecord('sys_ui_list_element');
    gr3.addEncodedQuery(
      'list_id.name=' + tableName + '^list_id.view.title=' + viewTitle + '^ORDERBYposition'
    );
    gr3.setLimit(50);
    gr3.query();
    var names3 = [];
    while (gr3.next()) {
      var el3 = String(gr3.getValue('element') || '');
      if (el3) names3.push(el3);
    }
    if (names3.length) return this.labelFields(tableName, names3);
    return [];
  },

  markerKind: function (el) {
    var tokens = [el.type, el.element];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === '.split') return 'split';
      if (t === '.end_split' || t === '.end') return 'end_split';
      if (t === '.begin_split') return 'begin_split';
    }
    if (!el.element || el.element.indexOf('.') === 0) return 'skip';
    return 'field';
  },

  parseElementRows: function (elems, fallbackColumns) {
    var rows = [];
    var mode = 'neutral';
    var pendingFields = [];
    var leftCol = [];
    var rightCol = [];
    var pastSplit = false;
    var sawSplitMarker = false;
    var self = this;

    var toField = function (e) {
      return { element: e.element, label: e.element };
    };

    var flushTwoCol = function () {
      if (!leftCol.length && !rightCol.length) return;
      rows.push({ kind: 'columns', left: leftCol.map(toField), right: rightCol.map(toField) });
      leftCol = [];
      rightCol = [];
      pastSplit = false;
    };

    var emitPendingAsFull = function () {
      for (var i = 0; i < pendingFields.length; i++) {
        rows.push({ kind: 'full', field: toField(pendingFields[i]) });
      }
      pendingFields = [];
    };

    var startTwoColBlock = function () {
      mode = 'two_col';
      leftCol = [];
      rightCol = [];
      pastSplit = false;
    };

    for (var idx = 0; idx < elems.length; idx++) {
      var el = elems[idx];
      switch (self.markerKind(el)) {
        case 'begin_split':
          sawSplitMarker = true;
          if (mode === 'neutral') emitPendingAsFull();
          else if (mode === 'two_col') flushTwoCol();
          startTwoColBlock();
          break;
        case 'split':
          sawSplitMarker = true;
          if (mode === 'neutral') {
            leftCol = pendingFields.slice(0);
            pendingFields = [];
            mode = 'two_col';
          } else if (mode === 'full_only') {
            startTwoColBlock();
          }
          pastSplit = true;
          break;
        case 'end_split':
          sawSplitMarker = true;
          if (mode === 'neutral') emitPendingAsFull();
          else if (mode === 'two_col') flushTwoCol();
          mode = 'full_only';
          break;
        case 'field':
          if (mode === 'neutral') pendingFields.push(el);
          else if (mode === 'full_only') rows.push({ kind: 'full', field: toField(el) });
          else if (pastSplit) rightCol.push(el);
          else leftCol.push(el);
          break;
        default:
          break;
      }
    }

    if (mode === 'neutral' && pendingFields.length) {
      if (!sawSplitMarker && fallbackColumns === 2) {
        for (var j = 0; j < pendingFields.length; j += 2) {
          if (j + 1 < pendingFields.length) {
            rows.push({
              kind: 'columns',
              left: [toField(pendingFields[j])],
              right: [toField(pendingFields[j + 1])],
            });
          } else {
            rows.push({ kind: 'full', field: toField(pendingFields[j]) });
          }
        }
      } else {
        emitPendingAsFull();
      }
    } else if (mode === 'two_col') {
      flushTwoCol();
    }

    return rows;
  },

  collectFieldNames: function (rows) {
    var names = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.kind === 'full') names.push(row.field.element);
      else {
        for (var l = 0; l < row.left.length; l++) names.push(row.left[l].element);
        for (var r = 0; r < row.right.length; r++) names.push(row.right[r].element);
      }
    }
    return names;
  },

  docLookupNames: function (elements) {
    var names = {};
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      names[el] = true;
      var dot = el.indexOf('.');
      if (dot > 0) names[el.substring(0, dot)] = true;
    }
    return Object.keys(names);
  },

  applySectionLabels: function (tableName, sections) {
    if (!sections || !sections.length) return sections;
    var allNames = [];
    for (var i = 0; i < sections.length; i++) {
      allNames = allNames.concat(this.collectFieldNames(sections[i].rows));
    }
    var labeled = this.labelFields(tableName, this.docLookupNames(allNames));
    var labelMap = {};
    for (var j = 0; j < labeled.length; j++) labelMap[labeled[j].element] = labeled[j].label;

    var labelFor = function (element) {
      if (labelMap[element]) return labelMap[element];
      var dot = element.indexOf('.');
      if (dot > 0 && labelMap[element.substring(0, dot)]) return labelMap[element.substring(0, dot)];
      return element.replace(/_/g, ' ').replace(/\./g, ' \u203a ').replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
    };

    for (var s = 0; s < sections.length; s++) {
      var rows = sections[s].rows;
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        if (row.kind === 'full') row.field.label = labelFor(row.field.element);
        else {
          for (var li = 0; li < row.left.length; li++) row.left[li].label = labelFor(row.left[li].element);
          for (var ri2 = 0; ri2 < row.right.length; ri2++) row.right[ri2].label = labelFor(row.right[ri2].element);
        }
      }
    }
    return sections;
  },

  findFormSysId: function (tableName, viewTitle) {
    var queries = viewTitle
      ? [
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY^active=true',
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY',
      ]
      : ['name=' + tableName + '^view.name=^sys_userISEMPTY^active=true', 'name=' + tableName + '^view.name=^sys_userISEMPTY'];
    for (var i = 0; i < queries.length; i++) {
      var gr = new GlideRecord('sys_ui_form');
      gr.addEncodedQuery(queries[i]);
      gr.setLimit(1);
      gr.query();
      if (gr.next()) return gr.getUniqueValue();
    }
    return '';
  },

  loadLegacySingleSection: function (tableName, viewTitle) {
    var query = viewTitle
      ? 'sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + tableName + '^ORDERBYposition'
      : 'sys_ui_section.view.name=^sys_ui_section.name=' + tableName + '^ORDERBYposition';
    var elems = this.queryUiElements(query, 200);
    var rows = this.parseElementRows(elems, 1);
    if (!this.collectFieldNames(rows).length) return null;
    return [{ caption: null, rows: rows }];
  },

  resolveFormLayoutFromTable: function (tableName, viewTitle) {
    var formId = this.findFormSysId(tableName, viewTitle);
    if (!formId) {
      var legacy = this.loadLegacySingleSection(tableName, viewTitle);
      return legacy ? this.applySectionLabels(tableName, legacy) : null;
    }

    var fsGr = new GlideRecord('sys_ui_form_section');
    fsGr.addQuery('sys_ui_form', formId);
    fsGr.orderBy('position');
    fsGr.setLimit(50);
    fsGr.query();
    if (!fsGr.hasNext()) {
      var legacy2 = this.loadLegacySingleSection(tableName, viewTitle);
      return legacy2 ? this.applySectionLabels(tableName, legacy2) : null;
    }

    var sections = [];
    while (fsGr.next()) {
      var sectionId = fsGr.getValue('sys_ui_section');
      if (!sectionId) continue;

      var secGr = new GlideRecord('sys_ui_section');
      if (!secGr.get(sectionId)) continue;
      var captionRaw = String(secGr.getValue('caption') || '').trim();
      var sectionColumns = parseInt(secGr.getValue('columns'), 10) >= 2 ? 2 : 1;

      var elems = this.queryUiElements('sys_ui_section=' + sectionId + '^ORDERBYposition', 200);
      var rows = this.parseElementRows(elems, sectionColumns);
      var fieldNames = this.collectFieldNames(rows);
      if (!fieldNames.length && !captionRaw) continue;
      sections.push({ caption: captionRaw || null, rows: rows });
    }

    if (!sections.length) return null;
    return this.applySectionLabels(tableName, sections);
  },

  tryLoadFormLayout: function (tableName, viewTitle) {
    var sections = this.resolveFormLayoutFromTable(tableName, viewTitle);
    if (!sections || !sections.length) return null;
    var hasFields = false;
    for (var i = 0; i < sections.length; i++) {
      if (this.collectFieldNames(sections[i].rows).length) {
        hasFields = true;
        break;
      }
    }
    if (!hasFields) return null;
    return {
      sections: sections,
      resolved_table: tableName,
      resolved_view: viewTitle ? 'named' : 'default',
    };
  },

  resolveFormLayout: function (recordTable, viewTitle, parentTable) {
    var parent = parentTable || this.getParentTable(recordTable);
    var attempts = [
      { table: recordTable, viewTitle: viewTitle },
      { table: parent, viewTitle: viewTitle },
      { table: this.CMDB_CI_TABLE, viewTitle: viewTitle },
      { table: recordTable, viewTitle: null },
      { table: parent, viewTitle: null },
      { table: this.CMDB_CI_TABLE, viewTitle: null },
    ];
    var seen = {};
    for (var i = 0; i < attempts.length; i++) {
      var a = attempts[i];
      if (!a.table) continue;
      var key = a.table + ':' + (a.viewTitle || 'default');
      if (seen[key]) continue;
      seen[key] = true;
      var result = this.tryLoadFormLayout(a.table, a.viewTitle);
      if (result) return result;
    }
    return {
      sections: [],
      resolved_table: recordTable,
      resolved_view: 'named',
    };
  },

  handleViewLayout: function (request, response) {
    var table = this.readParam(request, 'table');
    var viewTitle = this.readParam(request, 'view_title');
    var layoutType = this.readParam(request, 'type') || 'form';
    var defaultLimit = parseInt(this.readParam(request, 'default_limit') || '20', 10);
    var parentTable = this.readParam(request, 'parent_table');

    if (!table || !this.isAllowedTable(table)) {
      this.jsonError(response, 400, 'Invalid or missing table parameter');
      return;
    }

    if (layoutType === 'form_layout') {
      if (!viewTitle || !this.isAllowedViewTitle(viewTitle)) {
        this.jsonError(response, 400, 'Invalid or missing view_title for form_layout');
        return;
      }
      this.jsonOk(response, this.resolveFormLayout(table, viewTitle, parentTable || ''));
      return;
    }

    if (layoutType === 'list') {
      if (!viewTitle || !this.isAllowedViewTitle(viewTitle)) {
        this.jsonError(response, 400, 'Invalid or missing view_title for list layout');
        return;
      }
      this.jsonOk(response, { fields: this.resolveListFieldList(table, viewTitle) });
      return;
    }

    if (layoutType === 'form') {
      var title = viewTitle && this.isAllowedViewTitle(viewTitle) ? viewTitle : 'CLSA CMDB Workspace';
      this.jsonOk(response, {
        fields: this.resolveFormFieldList(table, title, defaultLimit),
      });
      return;
    }

    this.jsonError(response, 400, 'type must be form, list, or form_layout');
  },

  type: 'PortalMetadataHandler',
};
