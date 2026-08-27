var PortalMetadataHandler = Class.create();
PortalMetadataHandler.prototype = {
  initialize: function () {},

  APP_SCOPE: 'x_citi4_clsa_cmd_0',
  INST_TABLE: 'cmdb_ci_service_auto',
  SVC_TABLE: 'cmdb_ci_service',
  CMDB_CI_TABLE: 'cmdb_ci',

  CHOICE_TABLES: ['cmdb_ci_service_auto', 'cmdb_ci_service', 'cmdb_ci'],

  FILTER_CONFIG_PROP_2: 'x_citi4_clsa_cmd_0.app.home.filter.config.hierarchy.2',
  FILTER_CONFIG_PROP_3: 'x_citi4_clsa_cmd_0.app.home.filter.config.hierarchy.3',

  PROPERTY_NAMES: [
    'x_citi4_clsa_cmd_0.enable.new.app.hierarchy',
    'x_citi4_clsa_cmd_0.ci.filter',
    'x_citi4_clsa_cmd_0.ci.search.filter.table.field',
    'x_citi4_clsa_cmd_0.global.search.filter.table',
    'x_citi4_clsa_cmd_0.global.search.filter.table.field',
    'x_citi4_clsa_cmd_0.global.search.result.field',
    'x_citi4_clsa_cmd_0.app.relationship.depth',
    'x_citi4_clsa_cmd_0.app.to.app.relationship.types',
    'x_citi4_clsa_cmd_0.app.home.filter.config.hierarchy.2',
    'x_citi4_clsa_cmd_0.app.home.filter.config.hierarchy.3',
    'glide.csv.export.limit',
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

  /** Walk sys_db_object.super_class chain; true when table extends cmdb_ci. */
  tableExtendsCmdbCi: function (tableName) {
    if (!tableName) return false;
    if (tableName === this.CMDB_CI_TABLE) return true;
    var current = tableName;
    var seen = {};
    for (var i = 0; i < 12; i++) {
      if (!current || seen[current]) break;
      seen[current] = true;
      if (current === this.CMDB_CI_TABLE) return true;
      current = this.getParentTable(current);
    }
    return false;
  },

  isAllowedTable: function (tableName) {
    if (!tableName || !/^[a-z0-9_]+$/.test(tableName)) return false;
    if (tableName.indexOf('cmdb_') === 0 || tableName === 'task_ci') return true;
    return this.tableExtendsCmdbCi(tableName);
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
    var grafanaPrefix = this.APP_SCOPE + '.grafana.url.';
    var grafanaGr = new GlideRecord('sys_properties');
    grafanaGr.addQuery('name', 'STARTSWITH', grafanaPrefix);
    grafanaGr.query();
    while (grafanaGr.next()) {
      map[String(grafanaGr.getValue('name'))] = String(grafanaGr.getValue('value') || '');
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

  parseJsonProperty: function (raw) {
    if (!raw || !String(raw).trim()) return null;
    try {
      return JSON.parse(String(raw));
    } catch (e1) {
      try {
        var parser = new global.JSON();
        return parser.decode(String(raw));
      } catch (e2) {
        return null;
      }
    }
  },

  defaultFilterConfig: function (threeLevel) {
    if (threeLevel) {
      return {
        version: 1,
        filters: [
          {
            label: 'Environment',
            field: 'environment',
            order: 10,
            defaultOpen: true,
            optionsSource: {
              type: 'choice',
              element: 'environment',
              query: 'name=cmdb_ci_service_auto^element=environment^inactive=false^language=en',
              orderByField: 'label',
              orderByDirection: 'asc',
            },
          },
          {
            label: 'Status',
            field: 'operational_status',
            order: 20,
            defaultOpen: true,
            optionsSource: {
              type: 'choice',
              element: 'operational_status',
              query: 'name=cmdb_ci_service_auto^element=operational_status^inactive=false^language=en',
              orderByField: 'sequence',
              orderByDirection: 'asc',
            },
          },
          {
            label: 'Business Unit',
            field: 'business_unit',
            order: 30,
            defaultOpen: true,
            optionsSource: {
              type: 'reference',
              table: 'business_unit',
              labelField: 'name',
              valueField: 'sys_id',
              query: '',
              limit: 100,
              orderByField: 'name',
              orderByDirection: 'asc',
            },
          },
          {
            label: 'Department',
            field: 'department',
            order: 40,
            defaultOpen: true,
            optionsSource: {
              type: 'reference',
              table: 'cmn_department',
              labelField: 'description',
              labelFallbackField: 'name',
              valueField: 'sys_id',
              query: 'u_it_department=true',
              limit: 100,
              orderByField: 'name',
              orderByDirection: 'asc',
            },
          },
          {
            label: 'Tier',
            field: 'u_tier',
            order: 50,
            defaultOpen: true,
            dotWalk: true,
            optionsSource: {
              type: 'choice',
              element: 'u_tier',
              query: 'name=cmdb_ci_service_auto^element=u_tier^inactive=false^language=en',
              orderByField: 'sequence',
              orderByDirection: 'asc',
              fallback: this.TIER_FALLBACK,
            },
          },
        ],
      };
    }

    return {
      version: 1,
      filters: [
        {
          label: 'Status',
          field: 'operational_status',
          order: 10,
          defaultOpen: true,
          optionsSource: {
            type: 'choice',
            element: 'operational_status',
            query: 'name=cmdb_ci_service^element=operational_status^inactive=false^language=en',
            orderByField: 'sequence',
            orderByDirection: 'asc',
          },
        },
        {
          label: 'Business Unit',
          field: 'business_unit',
          order: 20,
          defaultOpen: true,
          optionsSource: {
            type: 'reference',
            table: 'business_unit',
            labelField: 'name',
            valueField: 'sys_id',
            query: '',
            limit: 100,
            orderByField: 'name',
            orderByDirection: 'asc',
          },
        },
        {
          label: 'Department',
          field: 'department',
          order: 30,
          defaultOpen: true,
          optionsSource: {
            type: 'reference',
            table: 'cmn_department',
            labelField: 'description',
            labelFallbackField: 'name',
            valueField: 'sys_id',
            query: 'u_it_department=true',
            limit: 100,
            orderByField: 'name',
            orderByDirection: 'asc',
          },
        },
        {
          label: 'Tier',
          field: 'u_tier',
          order: 40,
          defaultOpen: true,
          dotWalk: true,
          optionsSource: {
            type: 'choice',
            element: 'u_tier',
            query: 'name=cmdb_ci_service^element=u_tier^inactive=false^language=en',
            orderByField: 'sequence',
            orderByDirection: 'asc',
            fallback: this.TIER_FALLBACK,
          },
        },
      ],
    };
  },

  loadFilterConfigRaw: function (props, threeLevel) {
    var propName = threeLevel ? this.FILTER_CONFIG_PROP_3 : this.FILTER_CONFIG_PROP_2;
    var parsed = this.parseJsonProperty(props[propName]);
    if (!parsed || !parsed.filters || !parsed.filters.length) {
      return this.defaultFilterConfig(threeLevel);
    }
    return parsed;
  },

  applyOptionsOrderBy: function (gr, source, defaultField) {
    var field = String((source && source.orderByField) || defaultField || 'name');
    var dir = String((source && source.orderByDirection) || 'asc').toLowerCase();
    if (dir === 'desc') gr.orderByDesc(field);
    else gr.orderBy(field);
  },

  getChoiceOptionsFromSource: function (source) {
    if (!source) return [];
    var out = [];
    var seen = {};
    var gr = new GlideRecord('sys_choice');
    if (source.query) {
      gr.addEncodedQuery(String(source.query));
    } else if (source.element) {
      gr.addQuery('element', String(source.element));
      gr.addQuery('inactive', false);
      gr.addQuery('language', 'en');
    }
    this.applyOptionsOrderBy(gr, source, 'sequence');
    gr.query();
    while (gr.next()) {
      var value = String(gr.getValue('value') || '');
      var label = String(gr.getValue('label') || value);
      if (!value || seen[value]) continue;
      seen[value] = true;
      out.push({ value: value, label: label });
    }

    var allowed = source.allowedValues;
    if (allowed && allowed.length) {
      var allowMap = {};
      for (var a = 0; a < allowed.length; a++) allowMap[String(allowed[a])] = true;
      out = out.filter(function (c) { return allowMap[c.value]; });
      var byValue = {};
      for (var i = 0; i < out.length; i++) byValue[out[i].value] = out[i];
      var ordered = [];
      for (var j = 0; j < allowed.length; j++) {
        var key = String(allowed[j]);
        if (byValue[key]) ordered.push(byValue[key]);
      }
      out = ordered;
    }

    if (!out.length && source.fallback && source.fallback.length) {
      out = source.fallback;
    }
    return out;
  },

  getReferenceOptionsFromSource: function (source) {
    if (!source || !source.table) return [];
    var table = String(source.table);
    var labelField = String(source.labelField || 'name');
    var fallbackField = String(source.labelFallbackField || '');
    var limit = parseInt(source.limit, 10) || 100;
    var out = [];
    var gr = new GlideRecord(table);
    if (source.query) gr.addEncodedQuery(String(source.query));
    this.applyOptionsOrderBy(gr, source, labelField);
    gr.setLimit(limit);
    gr.query();
    while (gr.next()) {
      var label = String(gr.getValue(labelField) || gr.getDisplayValue(labelField) || '').trim();
      if (!label && fallbackField) {
        label = String(gr.getValue(fallbackField) || gr.getDisplayValue(fallbackField) || '').trim();
      }
      if (!label) label = gr.getUniqueValue();
      out.push({ label: label, value: gr.getUniqueValue() });
    }
    return out;
  },

  resolveFilterOptions: function (source) {
    if (!source || !source.type) return [];
    if (source.type === 'choice') return this.getChoiceOptionsFromSource(source);
    if (source.type === 'reference') return this.getReferenceOptionsFromSource(source);
    if (source.type === 'static' && source.options && source.options.length) {
      return source.options;
    }
    return [];
  },

  resolveFilterDefaults: function (defaultsSpec, options) {
    var values = [];
    if (!defaultsSpec) return values;

    if (Object.prototype.toString.call(defaultsSpec) === '[object Array]') {
      values = defaultsSpec;
    } else if (defaultsSpec.type === 'userField' && defaultsSpec.field) {
      var user = new GlideRecord('sys_user');
      if (user.get(gs.getUserID())) {
        var userVal = String(user.getValue(String(defaultsSpec.field)) || '');
        if (userVal) values = [userVal];
      }
    }

    if (!options || !options.length) return values;
    var optionValues = {};
    for (var i = 0; i < options.length; i++) optionValues[String(options[i].value)] = true;
    var filtered = [];
    for (var j = 0; j < values.length; j++) {
      var v = String(values[j]);
      if (optionValues[v]) filtered.push(v);
    }
    return filtered;
  },

  getCurrentUserContext: function () {
    var user = new GlideRecord('sys_user');
    if (!user.get(gs.getUserID())) {
      return { sys_id: '', department: '', company: '' };
    }
    return {
      sys_id: String(gs.getUserID() || ''),
      department: String(user.getValue('department') || ''),
      company: String(user.getValue('company') || ''),
    };
  },

  resolveAppHomeFilters: function (props, threeLevel) {
    var raw = this.loadFilterConfigRaw(props, threeLevel);
    var filters = raw.filters || [];
    filters.sort(function (a, b) {
      return (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0);
    });

    var resolved = [];
    for (var i = 0; i < filters.length; i++) {
      var def = filters[i];
      if (!def || !def.field) continue;
      var options = this.resolveFilterOptions(def.optionsSource);
      resolved.push({
        field: String(def.field),
        label: String(def.label || def.field),
        order: parseInt(def.order, 10) || 0,
        defaultOpen: def.defaultOpen !== false,
        dotWalk: Boolean(def.dotWalk),
        options: options,
        defaults: this.resolveFilterDefaults(def.defaults, options),
      });
    }
    return resolved;
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
      app_home_filter_config: {
        two_level: this.resolveAppHomeFilters(props, false),
        three_level: this.resolveAppHomeFilters(props, true),
      },
      current_user: this.getCurrentUserContext(),
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

  collectFormFieldNames: function (encodedQuery, limit) {
    var elems = this.queryUiElements(encodedQuery + '^ORDERBYposition', limit || 50);
    var names = [];
    for (var i = 0; i < elems.length; i++) {
      var el = elems[i].element;
      if (el && el.indexOf('.') !== 0) names.push(el);
    }
    return names;
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
      var names = this.collectFormFieldNames(steps[s], s === steps.length - 1 ? limit : 50);
      if (names.length) return this.labelFields(tableName, names);
    }
    return [];
  },

  /** App Home instance cards: fixed form-view fallback across CMDB tables. */
  resolveInstanceCardFormFields: function (viewTitle, defaultLimit) {
    var limit = defaultLimit || 50;
    var steps = [
      { table: this.INST_TABLE, named: true },
      { table: this.SVC_TABLE, named: true },
      { table: this.CMDB_CI_TABLE, named: true },
      { table: this.INST_TABLE, named: false },
      { table: this.SVC_TABLE, named: false },
      { table: this.CMDB_CI_TABLE, named: false },
    ];
    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      var query = step.named
        ? 'sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + step.table
        : 'sys_ui_section.view.name=^sys_ui_section.name=' + step.table;
      var names = this.collectFormFieldNames(query, limit);
      if (names.length) {
        return {
          fields: this.labelFields(step.table, names),
          resolved_table: step.table,
          resolved_view: step.named ? 'named' : 'default',
        };
      }
    }
    return {
      fields: [],
      resolved_table: this.INST_TABLE,
      resolved_view: 'default',
    };
  },

  findListSysId: function (encodedQuery) {
    var gr = new GlideRecord('sys_ui_list');
    gr.addEncodedQuery(encodedQuery);
    gr.setLimit(1);
    gr.query();
    return gr.next() ? gr.getUniqueValue() : '';
  },

  findViewSysId: function (viewTitle) {
    var gr = new GlideRecord('sys_ui_view');
    gr.addQuery('title', viewTitle);
    gr.setLimit(1);
    gr.query();
    return gr.next() ? gr.getUniqueValue() : '';
  },

  resolveListElementsByListId: function (listId, limit) {
    if (!listId) return [];
    var gr = new GlideRecord('sys_ui_list_element');
    gr.addQuery('list_id', listId);
    gr.orderBy('position');
    gr.setLimit(limit || 50);
    gr.query();
    var names = [];
    while (gr.next()) {
      var el = String(gr.getValue('element') || '');
      if (el) names.push(el);
    }
    return names;
  },

  resolveListLayout: function (tableName, viewTitle) {
    var userId = gs.getUserID();
    var empty = { fields: [], resolved_layout: 'default', list_sys_id: '' };

    var listId = this.findListSysId(
      'name=' + tableName + '^view.title=' + viewTitle + '^sys_user=' + userId
    );
    if (!listId) {
      listId = this.findListSysId(
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_user=' + userId + '^active=true'
      );
    }
    if (listId) {
      var personalNames = this.resolveListElementsByListId(listId, 50);
      if (personalNames.length) {
        return {
          fields: this.labelFields(tableName, personalNames),
          resolved_layout: 'personal',
          list_sys_id: listId,
        };
      }
    }

    listId = this.findListSysId(
      'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY^active=true'
    );
    if (!listId) {
      listId = this.findListSysId(
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY'
      );
    }
    if (listId) {
      var sharedNames = this.resolveListElementsByListId(listId, 50);
      if (sharedNames.length) {
        return {
          fields: this.labelFields(tableName, sharedNames),
          resolved_layout: 'shared',
          list_sys_id: listId,
        };
      }
    }

    listId = this.findListSysId('name=' + tableName + '^view.name=^sys_userISEMPTY');
    if (listId) {
      var defaultNames = this.resolveListElementsByListId(listId, 20);
      if (defaultNames.length) {
        return {
          fields: this.labelFields(tableName, defaultNames),
          resolved_layout: 'default',
          list_sys_id: listId,
        };
      }
    }

    var gr3 = new GlideRecord('sys_ui_list_element');
    gr3.addEncodedQuery(
      'list_id.name=' + tableName + '^list_id.view.title=' + viewTitle + '^ORDERBYposition'
    );
    gr3.setLimit(50);
    gr3.query();
    var dotNames = [];
    while (gr3.next()) {
      var el3 = String(gr3.getValue('element') || '');
      if (el3) dotNames.push(el3);
    }
    if (dotNames.length) {
      return {
        fields: this.labelFields(tableName, dotNames),
        resolved_layout: 'shared',
        list_sys_id: '',
      };
    }
    return empty;
  },

  resolveListFieldList: function (tableName, viewTitle) {
    return this.resolveListLayout(tableName, viewTitle).fields;
  },

  LIST_LAYOUT_EXCLUDED_TYPES: {
    collection: true,
    glide_list: true,
    password: true,
    password2: true,
    journal_input: true,
    html: true,
    user_image: true,
    template_value: true,
    conditions: true,
    composite_name: true,
    glide_action_list: true,
    workflow: true,
  },

  isListLayoutFieldType: function (internalType) {
    if (!internalType) return true;
    return !this.LIST_LAYOUT_EXCLUDED_TYPES[String(internalType)];
  },

  queryDictionaryFields: function (tableName, searchQuery, maxRows) {
    var out = [];
    var seen = {};
    var tablesSeen = {};
    var current = tableName;
    var limit = maxRows || 200;

    for (var depth = 0; depth < 12 && out.length < limit; depth++) {
      if (!current || tablesSeen[current]) break;
      tablesSeen[current] = true;

      var dict = new GlideRecord('sys_dictionary');
      dict.addQuery('name', current);
      dict.addQuery('active', true);
      dict.addQuery('element', '!=', '');
      dict.orderBy('column_label');
      dict.setLimit(limit);
      dict.query();
      while (dict.next() && out.length < limit) {
        var element = String(dict.getValue('element') || '');
        if (!element || element.indexOf('.') === 0 || seen[element]) continue;
        var internalType = String(dict.getValue('internal_type') || '');
        if (!this.isListLayoutFieldType(internalType)) continue;
        var label = String(dict.getValue('column_label') || element);
        if (searchQuery) {
          var q = searchQuery.toLowerCase();
          if (label.toLowerCase().indexOf(q) === -1 && element.toLowerCase().indexOf(q) === -1) continue;
        }
        seen[element] = true;
        out.push({
          element: element,
          label: label,
          internal_type: internalType,
        });
      }
      current = this.getParentTable(current);
    }

    out.sort(function (a, b) {
      return String(a.label).localeCompare(String(b.label));
    });
    return out;
  },

  isValidListColumn: function (tableName, element) {
    var current = tableName;
    var tablesSeen = {};
    for (var depth = 0; depth < 12; depth++) {
      if (!current || tablesSeen[current]) break;
      tablesSeen[current] = true;
      var dict = new GlideRecord('sys_dictionary');
      dict.addQuery('name', current);
      dict.addQuery('element', element);
      dict.addQuery('active', true);
      dict.setLimit(1);
      dict.query();
      if (dict.next()) {
        var internalType = String(dict.getValue('internal_type') || '');
        return this.isListLayoutFieldType(internalType);
      }
      current = this.getParentTable(current);
    }
    return false;
  },

  findUserListRecord: function (tableName, viewTitle, userId) {
    var listId = this.findListSysId(
      'name=' + tableName + '^view.title=' + viewTitle + '^sys_user=' + userId
    );
    if (!listId) return null;
    var gr = new GlideRecord('sys_ui_list');
    if (!gr.get(listId)) return null;
    return gr;
  },

  findSharedListRecord: function (tableName, viewTitle) {
    var listId = this.findListSysId(
      'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY^active=true'
    );
    if (!listId) {
      listId = this.findListSysId(
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY'
      );
    }
    if (!listId) return null;
    var gr = new GlideRecord('sys_ui_list');
    if (!gr.get(listId)) return null;
    return gr;
  },

  insertListElements: function (listId, columnNames) {
    for (var i = 0; i < columnNames.length; i++) {
      var elGr = new GlideRecord('sys_ui_list_element');
      elGr.initialize();
      elGr.setValue('list_id', listId);
      elGr.setValue('element', columnNames[i]);
      elGr.setValue('position', (i + 1) * 10);
      if (!elGr.insert()) return false;
    }
    return true;
  },

  deleteListElements: function (listId) {
    var gr = new GlideRecord('sys_ui_list_element');
    gr.addQuery('list_id', listId);
    gr.query();
    while (gr.next()) gr.deleteRecord();
  },

  createUserListFromShared: function (tableName, viewTitle, userId) {
    var sharedGr = this.findSharedListRecord(tableName, viewTitle);
    var viewId = sharedGr ? String(sharedGr.getValue('view') || '') : '';
    if (!viewId) viewId = this.findViewSysId(viewTitle);
    if (!viewId) {
      return { id: '', error: 'View not found: ' + viewTitle };
    }

    var listGr = new GlideRecord('sys_ui_list');
    listGr.initialize();
    listGr.setValue('name', tableName);
    listGr.setValue('view', viewId);
    listGr.setValue('sys_user', userId);
    listGr.setValue('sys_name', tableName);

    var id = listGr.insert();
    if (!id) {
      var msg = '';
      try {
        msg = String(listGr.getLastErrorMessage() || '');
      } catch (e0) {}
      return { id: '', error: msg || 'Failed to insert sys_ui_list' };
    }
    return { id: id, error: '' };
  },

  savePersonalListLayout: function (tableName, viewTitle, columnNames) {
    if (!columnNames || !columnNames.length) {
      return { ok: false, status: 400, message: 'columns must be a non-empty array' };
    }
    if (columnNames.length > 30) {
      return { ok: false, status: 400, message: 'Too many columns (max 30)' };
    }

    var hasName = false;
    for (var n = 0; n < columnNames.length; n++) {
      if (columnNames[n] === 'name') hasName = true;
      if (!this.isValidListColumn(tableName, columnNames[n])) {
        return { ok: false, status: 400, message: 'Invalid or unsupported column: ' + columnNames[n] };
      }
    }
    if (!hasName) {
      return { ok: false, status: 400, message: 'columns must include name' };
    }

    var userId = gs.getUserID();
    var listGr = this.findUserListRecord(tableName, viewTitle, userId);
    var listId = listGr ? listGr.getUniqueValue() : '';

    if (!listId) {
      var created = this.createUserListFromShared(tableName, viewTitle, userId);
      listId = created.id;
      if (!listId) {
        return {
          ok: false,
          status: 500,
          message: created.error || 'Failed to create personal list layout',
        };
      }
    }

    var backup = this.resolveListElementsByListId(listId, 50);
    this.deleteListElements(listId);
    if (!this.insertListElements(listId, columnNames)) {
      this.deleteListElements(listId);
      if (backup.length) this.insertListElements(listId, backup);
      return { ok: false, status: 500, message: 'Failed to save list columns' };
    }

    var layout = this.resolveListLayout(tableName, viewTitle);
    return { ok: true, layout: layout };
  },

  resetPersonalListLayout: function (tableName, viewTitle) {
    var userId = gs.getUserID();
    var listGr = this.findUserListRecord(tableName, viewTitle, userId);
    if (listGr) listGr.deleteRecord();
    return this.resolveListLayout(tableName, viewTitle);
  },

  sn: function (v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v !== null && 'value' in v) return String(v.value || '');
    return String(v);
  },

  readField: function (obj, name) {
    if (!obj) return '';
    var v = obj[name];
    if (v !== undefined && v !== null && String(v) !== '') return this.sn(v);
    try {
      if (typeof obj.get === 'function') {
        v = obj.get(name);
        if (v !== undefined && v !== null && String(v) !== '') return this.sn(v);
      }
    } catch (e1) {}
    return '';
  },

  bodyToObject: function (raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (e1) {
        try {
          var parser = new global.JSON();
          return parser.decode(raw);
        } catch (e2) {
          return null;
        }
      }
    }
    if (typeof raw === 'object') return raw;
    return null;
  },

  readStringArray: function (obj, name) {
    if (!obj || typeof obj !== 'object') return [];
    var raw = obj[name];
    if (!raw && typeof obj.get === 'function') {
      try {
        raw = obj.get(name);
      } catch (e0) {}
    }
    if (!raw) return [];

    var out = [];
    var pushValue = function (item) {
      var s = String(item || '').trim();
      if (s) out.push(s);
    };

    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) pushValue(raw[i]);
      return out;
    }

    if (typeof raw.size === 'function' && typeof raw.get === 'function') {
      for (var j = 0; j < raw.size(); j++) pushValue(raw.get(j));
      return out;
    }

    if (typeof raw.length === 'number') {
      for (var k = 0; k < raw.length; k++) pushValue(raw[k]);
      return out;
    }

    var single = this.sn(raw);
    return single ? [single] : [];
  },

  readJsonBody: function (request) {
    try {
      var wrapper = request.body;
      if (!wrapper) return {};

      var fromData = this.bodyToObject(wrapper.data);
      if (fromData && typeof fromData === 'object') return fromData;

      if (wrapper.dataString) {
        var parsed = this.bodyToObject(String(wrapper.dataString));
        if (parsed) return parsed;
      }

      if (typeof wrapper.hasNext === 'function' && wrapper.hasNext()) {
        var entry = wrapper.nextEntry();
        var fromEntry = this.bodyToObject(entry);
        if (fromEntry) return fromEntry;
      }

      if (this.readField(wrapper, 'table') || this.readField(wrapper, 'view_title')) return wrapper;

      if (typeof wrapper === 'string') {
        var fromString = this.bodyToObject(wrapper);
        if (fromString) return fromString;
      }

      return typeof wrapper === 'object' ? wrapper : {};
    } catch (e) {
      return {};
    }
  },

  handleListLayoutFields: function (request, response) {
    var table = this.readParam(request, 'table');
    var viewTitle = this.readParam(request, 'view_title');
    var q = this.readParam(request, 'q');

    if (!table || !this.isAllowedTable(table)) {
      this.jsonError(response, 400, 'Invalid or missing table parameter');
      return;
    }
    if (!viewTitle || !this.isAllowedViewTitle(viewTitle)) {
      this.jsonError(response, 400, 'Invalid or missing view_title parameter');
      return;
    }

    this.jsonOk(response, {
      fields: this.queryDictionaryFields(table, q, 200),
    });
  },

  handleListLayoutSave: function (request, response) {
    var body = this.readJsonBody(request);
    var table = this.readField(body, 'table').trim();
    var viewTitle = this.readField(body, 'view_title').trim();
    var normalized = this.readStringArray(body, 'columns');

    if (!table || !this.isAllowedTable(table)) {
      this.jsonError(response, 400, 'Invalid or missing table parameter');
      return;
    }
    if (!viewTitle || !this.isAllowedViewTitle(viewTitle)) {
      this.jsonError(response, 400, 'Invalid or missing view_title parameter');
      return;
    }
    if (!normalized.length) {
      this.jsonError(response, 400, 'columns must be a non-empty array');
      return;
    }

    var result = this.savePersonalListLayout(table, viewTitle, normalized);
    if (!result.ok) {
      this.jsonError(response, result.status || 400, result.message || 'Save failed');
      return;
    }

    this.jsonOk(response, result.layout);
  },

  handleListLayoutReset: function (request, response) {
    var table = this.readParam(request, 'table');
    var viewTitle = this.readParam(request, 'view_title');

    if (!table || !this.isAllowedTable(table)) {
      this.jsonError(response, 400, 'Invalid or missing table parameter');
      return;
    }
    if (!viewTitle || !this.isAllowedViewTitle(viewTitle)) {
      this.jsonError(response, 400, 'Invalid or missing view_title parameter');
      return;
    }

    this.jsonOk(response, this.resetPersonalListLayout(table, viewTitle));
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

    if (layoutType === 'instance_card_form') {
      if (!viewTitle || !this.isAllowedViewTitle(viewTitle)) {
        this.jsonError(response, 400, 'Invalid or missing view_title for instance_card_form');
        return;
      }
      this.jsonOk(response, this.resolveInstanceCardFormFields(viewTitle, defaultLimit));
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
      this.jsonOk(response, this.resolveListLayout(table, viewTitle));
      return;
    }

    if (layoutType === 'form') {
      var title = viewTitle && this.isAllowedViewTitle(viewTitle) ? viewTitle : 'CLSA CMDB Workspace';
      this.jsonOk(response, {
        fields: this.resolveFormFieldList(table, title, defaultLimit),
      });
      return;
    }

    this.jsonError(response, 400, 'type must be form, list, form_layout, or instance_card_form');
  },

  type: 'PortalMetadataHandler',
};
