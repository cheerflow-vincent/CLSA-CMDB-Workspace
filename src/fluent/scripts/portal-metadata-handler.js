var PortalMetadataHandler = Class.create(); // NOSONAR: ServiceNow Script Include class must use var (Class.create convention)
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
    'x_citi4_clsa_cmd_0.service.to.instance.relationship.types',
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
      if (request.queryParams?.[name]) {
        return String(request.queryParams[name] || '').trim();
      }
    } catch (error) {
      gs.debug('portal-metadata readParam failed for ' + name + ': ' + error);
    }
    return '';
  },

  /** Walk sys_db_object.super_class chain; true when table extends cmdb_ci. */
  tableExtendsCmdbCi: function (tableName) {
    if (!tableName) return false;
    if (tableName === this.CMDB_CI_TABLE) return true;
    let current = tableName;
    const seen = {};
    for (let i = 0; i < 12; i++) {
      if (!current || seen[current]) break;
      seen[current] = true;
      if (current === this.CMDB_CI_TABLE) return true;
      current = this.getParentTable(current);
    }
    return false;
  },

  isAllowedTable: function (tableName) {
    if (!tableName || !/^[a-z0-9_]+$/.test(tableName)) return false;
    if (tableName.startsWith('cmdb_') || tableName === 'task_ci') return true;
    return this.tableExtendsCmdbCi(tableName);
  },

  isAllowedViewTitle: function (title) {
    return Boolean(title && this.ALLOWED_VIEW_TITLES[title]);
  },

  getParentTable: function (tableName) {
    const db = new GlideRecord('sys_db_object');
    db.addQuery('name', tableName);
    db.setLimit(1);
    db.query();
    if (!db.next()) return '';
    try {
      if (db.super_class.nil?.()) return '';
      if (!db.super_class) return '';
      return String(db.super_class.name || '');
    } catch (error) {
      gs.debug('portal-metadata getParentTable failed for ' + tableName + ': ' + error);
      return '';
    }
  },

  getChoices: function (tableName, element) {
    const choices = [];
    const gr = new GlideRecord('sys_choice');
    gr.addQuery('name', tableName);
    gr.addQuery('element', element);
    gr.addQuery('inactive', false);
    gr.addQuery('language', 'en');
    gr.orderBy('sequence');
    gr.query();
    while (gr.next()) {
      const value = String(gr.getValue('value') || '');
      const label = String(gr.getValue('label') || value);
      if (!value) continue;
      choices.push({ value: value, label: label });
    }
    return choices;
  },

  getChoicesForField: function (tableName, element) {
    let current = tableName;
    const seen = {};
    for (let i = 0; i < 12; i++) {
      if (!current || seen[current]) break;
      seen[current] = true;
      const choices = this.getChoices(current, element);
      if (choices.length) return choices;
      current = this.getParentTable(current);
    }
    return [];
  },

  getMergedChoices: function (element, tableNames) {
    const seen = {};
    const out = [];
    for (const tableName of tableNames) {
      const choices = this.getChoicesForField(tableName, element);
      for (const c of choices) {
        if (seen[c.value]) continue;
        seen[c.value] = true;
        out.push(c);
      }
    }
    return out;
  },

  getPropertyMap: function () {
    const map = {};
    const gr = new GlideRecord('sys_properties');
    gr.addQuery('name', 'IN', this.PROPERTY_NAMES.join(','));
    gr.query();
    while (gr.next()) {
      map[String(gr.getValue('name'))] = String(gr.getValue('value') || '');
    }
    const grafanaPrefix = this.APP_SCOPE + '.grafana.url.';
    const grafanaGr = new GlideRecord('sys_properties');
    grafanaGr.addQuery('name', 'STARTSWITH', grafanaPrefix);
    grafanaGr.query();
    while (grafanaGr.next()) {
      map[String(grafanaGr.getValue('name'))] = String(grafanaGr.getValue('value') || '');
    }
    return map;
  },

  getReferenceOptions: function (table, fields, query, labelField) {
    const out = [];
    const gr = new GlideRecord(table);
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
    const out = [];
    const gr = new GlideRecord('cmn_department');
    gr.addQuery('u_it_department', true);
    gr.orderBy('name');
    gr.setLimit(100);
    gr.query();
    while (gr.next()) {
      const desc = String(gr.getValue('description') || '').trim();
      const name = String(gr.getValue('name') || '').trim();
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
    } catch (parseError) {
      gs.debug('portal-metadata parseJsonProperty JSON.parse failed, using GlideJSON: ' + parseError);
      try {
        const parser = new global.JSON();
        return parser.decode(String(raw));
      } catch (decodeError) {
        gs.debug('portal-metadata parseJsonProperty GlideJSON decode failed: ' + decodeError);
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
    const propName = threeLevel ? this.FILTER_CONFIG_PROP_3 : this.FILTER_CONFIG_PROP_2;
    const parsed = this.parseJsonProperty(props[propName]);
    if (!parsed?.filters?.length) {
      return this.defaultFilterConfig(threeLevel);
    }
    return parsed;
  },

  applyOptionsOrderBy: function (gr, source, defaultField) {
    const field = String((source?.orderByField) || defaultField || 'name');
    const dir = String((source?.orderByDirection) || 'asc').toLowerCase();
    if (dir === 'desc') gr.orderByDesc(field);
    else gr.orderBy(field);
  },

  _reorderByAllowed: function (out, allowed) {
    const allowMap = {};
    for (const allowedVal of allowed) allowMap[String(allowedVal)] = true;
    const filtered = out.filter(function (c) { return allowMap[c.value]; });
    const byValue = {};
    for (const opt of filtered) byValue[opt.value] = opt;
    const ordered = [];
    for (const element of allowed) {
      const key = String(element);
      if (byValue[key]) ordered.push(byValue[key]);
    }
    return ordered;
  },

  getChoiceOptionsFromSource: function (source) {
    if (!source) return [];
    let out = [];
    const seen = {};
    const gr = new GlideRecord('sys_choice');
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
      const value = String(gr.getValue('value') || '');
      const label = String(gr.getValue('label') || value);
      if (!value || seen[value]) continue;
      seen[value] = true;
      out.push({ value: value, label: label });
    }

    const allowed = source.allowedValues;
    if (allowed?.length) out = this._reorderByAllowed(out, allowed);
    if (!out.length && source.fallback?.length) out = source.fallback;
    return out;
  },

  getReferenceOptionsFromSource: function (source) {
    if (!source?.table) return [];
    const table = String(source.table);
    const labelField = String(source.labelField || 'name');
    const fallbackField = String(source.labelFallbackField || '');
    const limit = Number.parseInt(source.limit, 10) || 100;
    const out = [];
    const gr = new GlideRecord(table);
    if (source.query) gr.addEncodedQuery(String(source.query));
    this.applyOptionsOrderBy(gr, source, labelField);
    gr.setLimit(limit);
    gr.query();
    while (gr.next()) {
      let label = String(gr.getValue(labelField) || gr.getDisplayValue(labelField) || '').trim();
      if (!label && fallbackField) {
        label = String(gr.getValue(fallbackField) || gr.getDisplayValue(fallbackField) || '').trim();
      }
      if (!label) label = gr.getUniqueValue();
      out.push({ label: label, value: gr.getUniqueValue() });
    }
    return out;
  },

  resolveFilterOptions: function (source) {
    if (!source?.type) return [];
    if (source.type === 'choice') return this.getChoiceOptionsFromSource(source);
    if (source.type === 'reference') return this.getReferenceOptionsFromSource(source);
    if (source.type === 'static' && source.options?.length) {
      return source.options;
    }
    return [];
  },

  resolveFilterDefaults: function (defaultsSpec, options) {
    let values = [];
    if (!defaultsSpec) return values;

    if (Object.prototype.toString.call(defaultsSpec) === '[object Array]') {
      values = defaultsSpec;
    } else if (defaultsSpec.type === 'userField' && defaultsSpec.field) {
      const user = new GlideRecord('sys_user');
      if (user.get(gs.getUserID())) {
        const userVal = String(user.getValue(String(defaultsSpec.field)) || '');
        if (userVal) values = [userVal];
      }
    }

    if (!options?.length) return values;
    const optionValues = {};
    for (const opt of options) optionValues[String(opt.value)] = true;
    const filtered = [];
    for (const value of values) {
      const v = String(value);
      if (optionValues[v]) filtered.push(v);
    }
    return filtered;
  },

  getCurrentUserContext: function () {
    const user = new GlideRecord('sys_user');
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
    const raw = this.loadFilterConfigRaw(props, threeLevel);
    const filters = raw.filters || [];
    filters.sort(function (a, b) {
      return (Number.parseInt(a.order, 10) || 0) - (Number.parseInt(b.order, 10) || 0);
    });

    const resolved = [];
    for (const def of filters) {
      if (!def?.field) continue;
      const options = this.resolveFilterOptions(def.optionsSource);
      resolved.push({
        field: String(def.field),
        label: String(def.label || def.field),
        order: Number.parseInt(def.order, 10) || 0,
        defaultOpen: def.defaultOpen !== false,
        dotWalk: Boolean(def.dotWalk),
        options: options,
        defaults: this.resolveFilterDefaults(def.defaults, options),
      });
    }
    return resolved;
  },

  handleMetadata: function (request, response) {
    const props = this.getPropertyMap();
    const hierarchyVal = (props['x_citi4_clsa_cmd_0.enable.new.app.hierarchy'] || '').toLowerCase();
    let tier = this.getMergedChoices('u_tier', this.CHOICE_TABLES);
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
    const rows = [];
    const gr = new GlideRecord('sys_ui_element');
    gr.addEncodedQuery(encodedQuery);
    gr.orderBy('position');
    gr.setLimit(limit || 200);
    gr.query();
    while (gr.next()) {
      rows.push({
        element: String(gr.getValue('element') || ''),
        position: Number.parseInt(gr.getValue('position'), 10) || 0,
        type: String(gr.getValue('type') || ''),
      });
    }
    return rows;
  },

  labelFields: function (tableName, fieldNames) {
    if (!fieldNames.length) return [];
    const labelMap = {};
    const doc = new GlideRecord('sys_documentation');
    doc.addQuery('name', tableName);
    doc.addQuery('language', 'en');
    doc.addQuery('element', 'IN', fieldNames.join(','));
    doc.query();
    while (doc.next()) {
      labelMap[String(doc.getValue('element'))] = String(doc.getValue('label') || '');
    }

    const out = [];
    for (const el of fieldNames) {
      out.push({
        element: el,
        label: labelMap[el]
          || el.replaceAll('_', ' ').replaceAll('.', ' \u203a ').replaceAll(/\b\w/g, function (c) {
            return c.toUpperCase();
          }),
      });
    }
    return out;
  },

  collectFormFieldNames: function (encodedQuery, limit) {
    const elems = this.queryUiElements(encodedQuery + '^ORDERBYposition', limit || 50);
    const names = [];
    for (const elem of elems) {
      const el = elem.element;
      if (el && !el.startsWith('.')) names.push(el);
    }
    return names;
  },

  resolveFormFieldList: function (tableName, viewTitle, defaultLimit) {
    const limit = defaultLimit > 0 ? defaultLimit : 20;
    const steps = [
      'sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + tableName,
    ];
    if (tableName !== this.INST_TABLE) {
      steps.push('sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + this.INST_TABLE);
    }
    if (tableName !== this.SVC_TABLE) {
      steps.push('sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + this.SVC_TABLE);
    }
    steps.push('sys_ui_section.view.name=^sys_ui_section.name=' + tableName);

    for (let s = 0; s < steps.length; s++) {
      const names = this.collectFormFieldNames(steps[s], s === steps.length - 1 ? limit : 50);
      if (names.length) return this.labelFields(tableName, names);
    }
    return [];
  },

  /** App Home instance cards: fixed form-view fallback across CMDB tables. */
  resolveInstanceCardFormFields: function (viewTitle, defaultLimit) {
    const limit = defaultLimit > 0 ? defaultLimit : 50;
    const steps = [
      { table: this.INST_TABLE, named: true },
      { table: this.SVC_TABLE, named: true },
      { table: this.CMDB_CI_TABLE, named: true },
      { table: this.INST_TABLE, named: false },
      { table: this.SVC_TABLE, named: false },
      { table: this.CMDB_CI_TABLE, named: false },
    ];
    for (const step of steps) {
      const query = step.named
        ? 'sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + step.table
        : 'sys_ui_section.view.name=^sys_ui_section.name=' + step.table;
      const names = this.collectFormFieldNames(query, limit);
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
    const gr = new GlideRecord('sys_ui_list');
    gr.addEncodedQuery(encodedQuery);
    gr.setLimit(1);
    gr.query();
    return gr.next() ? gr.getUniqueValue() : '';
  },

  findViewSysId: function (viewTitle) {
    const gr = new GlideRecord('sys_ui_view');
    gr.addQuery('title', viewTitle);
    gr.setLimit(1);
    gr.query();
    return gr.next() ? gr.getUniqueValue() : '';
  },

  resolveListElementsByListId: function (listId, limit) {
    if (!listId) return [];
    const gr = new GlideRecord('sys_ui_list_element');
    gr.addQuery('list_id', listId);
    gr.orderBy('position');
    gr.setLimit(limit || 50);
    gr.query();
    const names = [];
    while (gr.next()) {
      const el = String(gr.getValue('element') || '');
      if (el) names.push(el);
    }
    return names;
  },

  resolveListLayout: function (tableName, viewTitle) {
    const userId = gs.getUserID();
    const empty = { fields: [], resolved_layout: 'default', list_sys_id: '' };

    let listId = this.findListSysId(
      'name=' + tableName + '^view.title=' + viewTitle + '^sys_user=' + userId
    );
    if (!listId) {
      listId = this.findListSysId(
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_user=' + userId + '^active=true'
      );
    }
    if (listId) {
      const personalNames = this.resolveListElementsByListId(listId, 50);
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
      const sharedNames = this.resolveListElementsByListId(listId, 50);
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
      const defaultNames = this.resolveListElementsByListId(listId, 20);
      if (defaultNames.length) {
        return {
          fields: this.labelFields(tableName, defaultNames),
          resolved_layout: 'default',
          list_sys_id: listId,
        };
      }
    }

    const gr3 = new GlideRecord('sys_ui_list_element');
    gr3.addEncodedQuery(
      'list_id.name=' + tableName + '^list_id.view.title=' + viewTitle + '^ORDERBYposition'
    );
    gr3.setLimit(50);
    gr3.query();
    const dotNames = [];
    while (gr3.next()) {
      const el3 = String(gr3.getValue('element') || '');
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

  _matchesDictField: function (dict, searchQuery, seen, out) {
    const element = String(dict.getValue('element') || '');
    if (!element || element.startsWith('.') || seen[element]) return;
    const internalType = String(dict.getValue('internal_type') || '');
    if (!this.isListLayoutFieldType(internalType)) return;
    const label = String(dict.getValue('column_label') || element);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!label.toLowerCase().includes(q) && !element.toLowerCase().includes(q)) return;
    }
    seen[element] = true;
    out.push({ element: element, label: label, internal_type: internalType });
  },

  queryDictionaryFields: function (tableName, searchQuery, maxRows) {
    const out = [];
    const seen = {};
    const tablesSeen = {};
    let current = tableName;
    const limit = maxRows > 0 ? maxRows : 200;

    for (let depth = 0; depth < 12 && out.length < limit; depth++) {
      if (!current || tablesSeen[current]) break;
      tablesSeen[current] = true;

      const dict = new GlideRecord('sys_dictionary');
      dict.addQuery('name', current);
      dict.addQuery('active', true);
      dict.addQuery('element', '!=', '');
      dict.orderBy('column_label');
      dict.setLimit(limit);
      dict.query();
      while (dict.next() && out.length < limit) {
        this._matchesDictField(dict, searchQuery, seen, out);
      }
      current = this.getParentTable(current);
    }

    out.sort(function (a, b) {
      return String(a.label).localeCompare(String(b.label));
    });
    return out;
  },

  isValidListColumn: function (tableName, element) {
    let current = tableName;
    const tablesSeen = {};
    for (let depth = 0; depth < 12; depth++) {
      if (!current || tablesSeen[current]) break;
      tablesSeen[current] = true;
      const dict = new GlideRecord('sys_dictionary');
      dict.addQuery('name', current);
      dict.addQuery('element', element);
      dict.addQuery('active', true);
      dict.setLimit(1);
      dict.query();
      if (dict.next()) {
        const internalType = String(dict.getValue('internal_type') || '');
        return this.isListLayoutFieldType(internalType);
      }
      current = this.getParentTable(current);
    }
    return false;
  },

  findUserListRecord: function (tableName, viewTitle, userId) {
    const listId = this.findListSysId(
      'name=' + tableName + '^view.title=' + viewTitle + '^sys_user=' + userId
    );
    if (!listId) return null;
    const gr = new GlideRecord('sys_ui_list');
    if (!gr.get(listId)) return null;
    return gr;
  },

  findSharedListRecord: function (tableName, viewTitle) {
    let listId = this.findListSysId(
      'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY^active=true'
    );
    if (!listId) {
      listId = this.findListSysId(
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY'
      );
    }
    if (!listId) return null;
    const gr = new GlideRecord('sys_ui_list');
    if (!gr.get(listId)) return null;
    return gr;
  },

  insertListElements: function (listId, columnNames) {
    for (const [i, columnName] of columnNames.entries()) {
      const elGr = new GlideRecord('sys_ui_list_element');
      elGr.initialize();
      elGr.setValue('list_id', listId);
      elGr.setValue('element', columnName);
      elGr.setValue('position', (i + 1) * 10);
      if (!elGr.insert()) return false;
    }
    return true;
  },

  deleteListElements: function (listId) {
    const gr = new GlideRecord('sys_ui_list_element');
    gr.addQuery('list_id', listId);
    gr.query();
    while (gr.next()) gr.deleteRecord();
  },

  createUserListFromShared: function (tableName, viewTitle, userId) {
    const sharedGr = this.findSharedListRecord(tableName, viewTitle);
    let viewId = sharedGr ? String(sharedGr.getValue('view') || '') : '';
    if (!viewId) viewId = this.findViewSysId(viewTitle);
    if (!viewId) {
      return { id: '', error: 'View not found: ' + viewTitle };
    }

    const listGr = new GlideRecord('sys_ui_list');
    listGr.initialize();
    listGr.setValue('name', tableName);
    listGr.setValue('view', viewId);
    listGr.setValue('sys_user', userId);
    listGr.setValue('sys_name', tableName);

    const id = listGr.insert();
    if (!id) {
      let msg = '';
      try {
        msg = String(listGr.getLastErrorMessage() || '');
      } catch (error) { gs.debug('portal-metadata getLastErrorMessage unavailable: ' + error); }
      return { id: '', error: msg || 'Failed to insert sys_ui_list' };
    }
    return { id: id, error: '' };
  },

  LIST_LAYOUT_MAX_COLUMNS: 30,

  savePersonalListLayout: function (tableName, viewTitle, columnNames) {
    if (!columnNames?.length) {
      return { ok: false, status: 400, message: 'columns must be a non-empty array' };
    }
    if (columnNames.length > this.LIST_LAYOUT_MAX_COLUMNS) {
      return { ok: false, status: 400, message: 'Too many columns (max ' + this.LIST_LAYOUT_MAX_COLUMNS + ')' };
    }

    let hasName = false;
    for (const columnName of columnNames) {
      if (columnName === 'name') hasName = true;
      if (!this.isValidListColumn(tableName, columnName)) {
        return { ok: false, status: 400, message: 'Invalid or unsupported column: ' + columnName };
      }
    }
    if (!hasName) {
      return { ok: false, status: 400, message: 'columns must include name' };
    }

    const userId = gs.getUserID();
    const listGr = this.findUserListRecord(tableName, viewTitle, userId);
    let listId = listGr ? listGr.getUniqueValue() : '';

    if (!listId) {
      const created = this.createUserListFromShared(tableName, viewTitle, userId);
      listId = created.id;
      if (!listId) {
        return {
          ok: false,
          status: 500,
          message: created.error || 'Failed to create personal list layout',
        };
      }
    }

    const backup = this.resolveListElementsByListId(listId, 50);
    this.deleteListElements(listId);
    if (!this.insertListElements(listId, columnNames)) {
      this.deleteListElements(listId);
      if (backup.length) this.insertListElements(listId, backup);
      return { ok: false, status: 500, message: 'Failed to save list columns' };
    }

    const layout = this.resolveListLayout(tableName, viewTitle);
    return { ok: true, layout: layout };
  },

  resetPersonalListLayout: function (tableName, viewTitle) {
    const userId = gs.getUserID();
    const listGr = this.findUserListRecord(tableName, viewTitle, userId);
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
    let v = obj[name];
    if (v !== undefined && v !== null && String(v) !== '') return this.sn(v);
    try {
      if (typeof obj.get === 'function') {
        v = obj.get(name);
        if (v !== undefined && v !== null && String(v) !== '') return this.sn(v);
      }
    } catch (error) { gs.debug('portal-metadata readField obj.get probe failed: ' + error); }
    return '';
  },

  bodyToObject: function (raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (parseError) {
        gs.debug('portal-metadata bodyToObject JSON.parse failed, using GlideJSON: ' + parseError);
        try {
          const parser = new global.JSON();
          return parser.decode(raw);
        } catch (decodeError) {
          gs.debug('portal-metadata bodyToObject GlideJSON decode failed: ' + decodeError);
          return null;
        }
      }
    }
    if (typeof raw === 'object') return raw;
    return null;
  },

  _readFromGlideList: function (raw, out) {
    for (let j = 0; j < raw.size(); j++) this._pushStringValue(out, raw.get(j));
    return out;
  },

  _pushStringValue: function (out, item) {
    const s = String(item || '').trim();
    if (s) out.push(s);
  },

  readStringArray: function (obj, name) {
    if (!obj || typeof obj !== 'object') return [];
    let raw = obj[name];
    if (!raw && typeof obj.get === 'function') {
      try {
        raw = obj.get(name);
      } catch (error) { gs.debug('portal-metadata readStringArray obj.get probe failed: ' + error); }
    }
    if (!raw) return [];

    const out = [];

    if (Array.isArray(raw)) {
      for (const item of raw) this._pushStringValue(out, item);
      return out;
    }

    if (typeof raw.size === 'function' && typeof raw.get === 'function') {
      return this._readFromGlideList(raw, out);
    }

    if (typeof raw.length === 'number') {
      for (const item of raw) this._pushStringValue(out, item);
      return out;
    }

    const single = this.sn(raw);
    return single ? [single] : [];
  },

  _readFromData: function (wrapper) {
    const fromData = this.bodyToObject(wrapper.data);
    return (fromData && typeof fromData === 'object') ? fromData : null;
  },

  _readFromDataString: function (wrapper) {
    if (!wrapper.dataString) return null;
    return this.bodyToObject(String(wrapper.dataString)) || null;
  },

  _readFromEntry: function (wrapper) {
    if (typeof wrapper.hasNext !== 'function' || !wrapper.hasNext()) return null;
    const entry = wrapper.nextEntry();
    return this.bodyToObject(entry) || null;
  },

  readJsonBody: function (request) {
    try {
      const wrapper = request.body;
      if (!wrapper) return {};

      const result = this._readFromData(wrapper)
        ?? this._readFromDataString(wrapper)
        ?? this._readFromEntry(wrapper);
      if (result) return result;

      if (this.readField(wrapper, 'table') || this.readField(wrapper, 'view_title')) return wrapper;
      if (typeof wrapper === 'string') {
        const fromString = this.bodyToObject(wrapper);
        if (fromString) return fromString;
      }
      return typeof wrapper === 'object' ? wrapper : {};
    } catch (error) {
      gs.debug('portal-metadata readJsonBody failed: ' + error);
      return {};
    }
  },

  handleListLayoutFields: function (request, response) {
    const table = this.readParam(request, 'table');
    const viewTitle = this.readParam(request, 'view_title');
    const q = this.readParam(request, 'q');

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
    const body = this.readJsonBody(request);
    const table = this.readField(body, 'table').trim();
    const viewTitle = this.readField(body, 'view_title').trim();
    const normalized = this.readStringArray(body, 'columns');

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

    const result = this.savePersonalListLayout(table, viewTitle, normalized);
    if (!result.ok) {
      this.jsonError(response, result.status || 400, result.message || 'Save failed');
      return;
    }

    this.jsonOk(response, result.layout);
  },

  handleListLayoutReset: function (request, response) {
    const table = this.readParam(request, 'table');
    const viewTitle = this.readParam(request, 'view_title');

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

  toField: function (e) {
    return { element: e.element, label: e.element };
  },

  markerKind: function (el) {
    const tokens = [el.type, el.element];
    for (const t of tokens) {
      if (t === '.split') return 'split';
      if (t === '.end_split' || t === '.end') return 'end_split';
      if (t === '.begin_split') return 'begin_split';
    }
    if (!el.element || el.element.startsWith('.')) return 'skip';
    return 'field';
  },

  _flushTwoCol: function (state) {
    if (!state.leftCol.length && !state.rightCol.length) return;
    state.rows.push({ kind: 'columns', left: state.leftCol.map(this.toField), right: state.rightCol.map(this.toField) });
    state.leftCol = [];
    state.rightCol = [];
    state.pastSplit = false;
  },

  _emitPendingAsFull: function (state) {
    for (const pendingField of state.pendingFields) {
      state.rows.push({ kind: 'full', field: this.toField(pendingField) });
    }
    state.pendingFields = [];
  },

  _startTwoColBlock: function (state) {
    state.mode = 'two_col';
    state.leftCol = [];
    state.rightCol = [];
    state.pastSplit = false;
  },

  _placeFieldEl: function (el, state) {
    if (state.mode === 'neutral') state.pendingFields.push(el);
    else if (state.mode === 'full_only') state.rows.push({ kind: 'full', field: this.toField(el) });
    else if (state.pastSplit) state.rightCol.push(el);
    else state.leftCol.push(el);
  },

  _processElement: function (el, state) {
    const kind = this.markerKind(el);
    if (kind === 'begin_split') {
      if (state.mode === 'neutral') this._emitPendingAsFull(state);
      else if (state.mode === 'two_col') this._flushTwoCol(state);
      this._startTwoColBlock(state);
      return true;
    }
    if (kind === 'split') {
      if (state.mode === 'neutral') {
        state.leftCol = state.pendingFields.slice(0);
        state.pendingFields = [];
        state.mode = 'two_col';
      } else if (state.mode === 'full_only') {
        this._startTwoColBlock(state);
      }
      state.pastSplit = true;
      return true;
    }
    if (kind === 'end_split') {
      if (state.mode === 'neutral') this._emitPendingAsFull(state);
      else if (state.mode === 'two_col') this._flushTwoCol(state);
      state.mode = 'full_only';
      return true;
    }
    if (kind === 'field') this._placeFieldEl(el, state);
    return false;
  },

  _finalizeElementRows: function (state, sawSplitMarker, fallbackColumns) {
    const { rows, mode, pendingFields } = state;
    if (mode === 'neutral' && pendingFields.length) {
      if (!sawSplitMarker && fallbackColumns === 2) {
        for (let j = 0; j < pendingFields.length; j += 2) {
          if (j + 1 < pendingFields.length) {
            rows.push({ kind: 'columns', left: [this.toField(pendingFields[j])], right: [this.toField(pendingFields[j + 1])] });
          } else {
            rows.push({ kind: 'full', field: this.toField(pendingFields[j]) });
          }
        }
      } else {
        this._emitPendingAsFull(state);
      }
    } else if (mode === 'two_col') {
      this._flushTwoCol(state);
    }
  },

  parseElementRows: function (elems, fallbackColumns) {
    const state = {
      rows: [],
      mode: 'neutral',
      pendingFields: [],
      leftCol: [],
      rightCol: [],
      pastSplit: false,
    };
    let sawSplitMarker = false;
    for (const el of elems) {
      if (this._processElement(el, state)) sawSplitMarker = true;
    }
    this._finalizeElementRows(state, sawSplitMarker, fallbackColumns);
    return state.rows;
  },

  collectFieldNames: function (rows) {
    const names = [];
    for (const row of rows) {
      if (row.kind === 'full') names.push(row.field.element);
      else {
        for (const cell of row.left) names.push(cell.element);
        for (const cell of row.right) names.push(cell.element);
      }
    }
    return names;
  },

  docLookupNames: function (elements) {
    const names = {};
    for (const el of elements) {
      names[el] = true;
      const dot = el.indexOf('.');
      if (dot > 0) names[el.substring(0, dot)] = true;
    }
    return Object.keys(names);
  },

  _applyRowLabel: function (row, labelMap) {
    if (row.kind === 'full') {
      row.field.label = this._labelFor(labelMap, row.field.element);
    } else {
      for (const cell of row.left) cell.label = this._labelFor(labelMap, cell.element);
      for (const cell of row.right) cell.label = this._labelFor(labelMap, cell.element);
    }
  },

  _labelFor: function (labelMap, element) {
    if (labelMap[element]) return labelMap[element];
    const dot = element.indexOf('.');
    if (dot > 0 && labelMap[element.substring(0, dot)]) return labelMap[element.substring(0, dot)];
    return element.replaceAll('_', ' ').replaceAll('.', ' \u203a ').replaceAll(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  },

  applySectionLabels: function (tableName, sections) {
    if (!sections?.length) return sections;
    let allNames = [];
    for (const section of sections) {
      allNames = allNames.concat(this.collectFieldNames(section.rows));
    }
    const labeled = this.labelFields(tableName, this.docLookupNames(allNames));
    const labelMap = {};
    for (const item of labeled) labelMap[item.element] = item.label;

    for (const section of sections) {
      for (const row of section.rows) this._applyRowLabel(row, labelMap);
    }
    return sections;
  },

  findFormSysId: function (tableName, viewTitle) {
    const queries = viewTitle
      ? [
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY^active=true',
        'name=' + tableName + '^view.title=' + viewTitle + '^sys_userISEMPTY',
      ]
      : ['name=' + tableName + '^view.name=^sys_userISEMPTY^active=true', 'name=' + tableName + '^view.name=^sys_userISEMPTY'];
    for (const query of queries) {
      const gr = new GlideRecord('sys_ui_form');
      gr.addEncodedQuery(query);
      gr.setLimit(1);
      gr.query();
      if (gr.next()) return gr.getUniqueValue();
    }
    return '';
  },

  loadLegacySingleSection: function (tableName, viewTitle) {
    const query = viewTitle
      ? 'sys_ui_section.view.title=' + viewTitle + '^sys_ui_section.name=' + tableName + '^ORDERBYposition'
      : 'sys_ui_section.view.name=^sys_ui_section.name=' + tableName + '^ORDERBYposition';
    const elems = this.queryUiElements(query, 200);
    const rows = this.parseElementRows(elems, 1);
    if (!this.collectFieldNames(rows).length) return null;
    return [{ caption: null, rows: rows }];
  },

  _buildSection: function (sectionId) {
    const secGr = new GlideRecord('sys_ui_section');
    if (!secGr.get(sectionId)) return null;
    const captionRaw = String(secGr.getValue('caption') || '').trim();
    const sectionColumns = Number.parseInt(secGr.getValue('columns'), 10) >= 2 ? 2 : 1;
    const elems = this.queryUiElements('sys_ui_section=' + sectionId + '^ORDERBYposition', 200);
    const rows = this.parseElementRows(elems, sectionColumns);
    if (!this.collectFieldNames(rows).length && !captionRaw) return null;
    return { caption: captionRaw || null, rows: rows };
  },

  resolveFormLayoutFromTable: function (tableName, viewTitle) {
    const formId = this.findFormSysId(tableName, viewTitle);
    if (!formId) {
      const legacy = this.loadLegacySingleSection(tableName, viewTitle);
      return legacy ? this.applySectionLabels(tableName, legacy) : null;
    }

    const fsGr = new GlideRecord('sys_ui_form_section');
    fsGr.addQuery('sys_ui_form', formId);
    fsGr.orderBy('position');
    fsGr.setLimit(50);
    fsGr.query();
    if (!fsGr.hasNext()) {
      const legacy2 = this.loadLegacySingleSection(tableName, viewTitle);
      return legacy2 ? this.applySectionLabels(tableName, legacy2) : null;
    }

    const sections = [];
    while (fsGr.next()) {
      const sectionId = fsGr.getValue('sys_ui_section');
      if (!sectionId) continue;
      const section = this._buildSection(sectionId);
      if (section) sections.push(section);
    }

    if (!sections.length) return null;
    return this.applySectionLabels(tableName, sections);
  },

  tryLoadFormLayout: function (tableName, viewTitle) {
    const sections = this.resolveFormLayoutFromTable(tableName, viewTitle);
    if (!sections?.length) return null;
    let hasFields = false;
    for (const section of sections) {
      if (this.collectFieldNames(section.rows).length) {
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
    const parent = parentTable || this.getParentTable(recordTable);
    const attempts = [
      { table: recordTable, viewTitle: viewTitle },
      { table: parent, viewTitle: viewTitle },
      { table: this.CMDB_CI_TABLE, viewTitle: viewTitle },
      { table: recordTable, viewTitle: null },
      { table: parent, viewTitle: null },
      { table: this.CMDB_CI_TABLE, viewTitle: null },
    ];
    const seen = {};
    for (const a of attempts) {
      if (!a.table) continue;
      const key = a.table + ':' + (a.viewTitle || 'default');
      if (seen[key]) continue;
      seen[key] = true;
      const result = this.tryLoadFormLayout(a.table, a.viewTitle);
      if (result) return result;
    }
    return {
      sections: [],
      resolved_table: recordTable,
      resolved_view: 'named',
    };
  },

  handleViewLayout: function (request, response) {
    const table = this.readParam(request, 'table');
    const viewTitle = this.readParam(request, 'view_title');
    const layoutType = this.readParam(request, 'type') || 'form';
    const defaultLimit = Number.parseInt(this.readParam(request, 'default_limit') || '20', 10);
    const parentTable = this.readParam(request, 'parent_table');

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
      const title = viewTitle && this.isAllowedViewTitle(viewTitle) ? viewTitle : 'CLSA CMDB Workspace';
      this.jsonOk(response, {
        fields: this.resolveFormFieldList(table, title, defaultLimit),
      });
      return;
    }

    this.jsonError(response, 400, 'type must be form, list, form_layout, or instance_card_form');
  },

  type: 'PortalMetadataHandler',
};
