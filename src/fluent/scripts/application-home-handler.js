var ApplicationHomeHandler = Class.create(); // NOSONAR: ServiceNow Script Include class must use var (Class.create convention)
ApplicationHomeHandler.prototype = {
  initialize: function () {},

  REL_CI_IN_CHUNK: 50,
  EDGE_BATCH: 100,
  MAX_EDGES: 50000,
  CACHE_PREFIX: 'clsa_app_home_filter_',
  UNFILTERED_CACHE_PREFIX: 'clsa_app_home_unfiltered_v2_',
  CACHE_TTL_MS: 15 * 60 * 1000,
  DEFAULT_PAGE_SIZE: 50,
  LOG_SOURCE: 'CLSA.AppHome',
  OTHERS_FAMILY_ID: '__others__',
  OTHERS_SVC_ID: '__others_svc__',
  OTHERS_FAMILY_NAME: '[Others]',

  APP_SCOPE: 'x_citi4_clsa_cmd_0',
  FILTER_CONFIG_PROP_2: 'x_citi4_clsa_cmd_0.app.home.filter.config.hierarchy.2',
  FILTER_CONFIG_PROP_3: 'x_citi4_clsa_cmd_0.app.home.filter.config.hierarchy.3',

  TIER_FALLBACK: [
    { label: 'Tier 0', value: '0' },
    { label: 'Tier 1', value: '1' },
    { label: 'Tier 2', value: '2' },
    { label: 'Tier 3', value: '3' },
  ],

  /** Writes to System Logs → Application Logs (filter source: CLSA.AppHome). */
  logQuery: function (label, message) {
    gs.info('[CLSA AppHome] ' + label + ' | ' + message, this.LOG_SOURCE);
  },

  jsonError: function (response, status, message) {
    response.setStatus(status);
    response.setContentType('application/json');
    response.setBody({ error: message });
  },

  jsonOk: function (response, body) {
    response.setContentType('application/json');
    response.setBody({ result: body });
  },

  scriptError: function (e) {
    if (!e) return 'Unknown server error';
    if (typeof e === 'string') return e;
    if (e.message) return String(e.message);
    return String(e);
  },

  sn: function (v) {
    if (!v) return '';
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
    } catch (error) { gs.debug('application-home readField obj.get probe failed: ' + error); }
    return '';
  },

  readStringArray: function (obj, name) {
    const raw = obj[name];
    if (!raw) return [];
    if (Array.isArray(raw)) {
      const out = [];
      for (const element of raw) {
        const s = this.sn(element);
        if (s) out.push(s);
      }
      return out;
    }
    const single = this.sn(raw);
    return single ? [single] : [];
  },

  bodyToObject: function (raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (parseError) {
        gs.debug('application-home bodyToObject JSON.parse failed, using GlideJSON: ' + parseError);
        try {
          const parser = new global.JSON();
          return parser.decode(raw);
        } catch (decodeError) {
          gs.debug('application-home bodyToObject GlideJSON decode failed: ' + decodeError);
          return null;
        }
      }
    }
    if (typeof raw === 'object') return raw;
    return null;
  },

  parseBody: function (request) {
    try {
      const wrapper = request.body;
      if (!wrapper) return {};

      const fromData = this.bodyToObject(wrapper.data);
      if (fromData && typeof fromData === 'object') return fromData;

      if (wrapper.dataString) {
        const parsed = this.bodyToObject(String(wrapper.dataString));
        if (parsed) return parsed;
      }

      if (typeof wrapper.hasNext === 'function' && wrapper.hasNext()) {
        const entry = wrapper.nextEntry();
        const fromEntry = this.bodyToObject(entry);
        if (fromEntry) return fromEntry;
      }

      // Some instances expose POST JSON fields directly on the wrapper object.
      if (this.readField(wrapper, 'hierarchy_mode')) return wrapper;

      return {};
    } catch (error) {
      gs.debug('application-home parseBody failed: ' + error);
      return null;
    }
  },

  _parseStructuredFilters: function (rawFilters) {
    const filters = {};
    for (const key in rawFilters) {
      if (!rawFilters.hasOwnProperty(key)) continue;
      const vals = this.readStringArray(rawFilters, key);
      if (vals.length) filters[key] = vals;
    }
    return filters;
  },

  normalizeCriteria: function (body) {
    const rawFilters = body.filters;
    let filters = {};
    if (rawFilters && typeof rawFilters === 'object' && !Array.isArray(rawFilters)) {
      filters = this._parseStructuredFilters(rawFilters);
    } else {
      const env = this.readStringArray(body, 'env');
      const status = this.readStringArray(body, 'status');
      const dept = this.readStringArray(body, 'dept');
      const bizUnit = this.readStringArray(body, 'biz_unit');
      const tier = this.readStringArray(body, 'tier');
      if (env.length) filters.environment = env;
      if (status.length) filters.operational_status = status;
      if (dept.length) filters.department = dept;
      if (bizUnit.length) filters.business_unit = bizUnit;
      if (tier.length) filters.u_tier = tier;
    }
    return { search: this.readField(body, 'search'), filters: filters };
  },

  hasActiveFilters: function (criteria) {
    if (criteria.search && String(criteria.search).trim()) return true;
    const filters = criteria.filters || {};
    for (const key in filters) {
      if (!filters.hasOwnProperty(key)) continue;
      if (filters[key]?.length) return true;
    }
    return false;
  },

  parseJsonProperty: function (raw) {
    return this.bodyToObject(raw);
  },

  defaultFilterConfig: function (threeLevel) {
    if (threeLevel) {
      return {
        version: 1,
        filters: [
          { field: 'environment', dotWalk: false },
          { field: 'operational_status', dotWalk: false },
          { field: 'business_unit', dotWalk: false },
          { field: 'department', dotWalk: false },
          { field: 'u_tier', dotWalk: true },
        ],
      };
    }
    return {
      version: 1,
      filters: [
        { field: 'operational_status', dotWalk: false },
        { field: 'business_unit', dotWalk: false },
        { field: 'department', dotWalk: false },
        { field: 'u_tier', dotWalk: true },
      ],
    };
  },

  loadFilterConfigRaw: function (threeLevel) {
    const propName = threeLevel ? this.FILTER_CONFIG_PROP_3 : this.FILTER_CONFIG_PROP_2;
    const raw = gs.getProperty(propName, '');
    const parsed = this.parseJsonProperty(raw);
    if (!parsed?.filters?.length) {
      return this.defaultFilterConfig(threeLevel);
    }
    return parsed;
  },

  getFilterDefsForHierarchy: function (threeLevel) {
    const raw = this.loadFilterConfigRaw(threeLevel);
    const filters = raw.filters || [];
    const defs = [];
    for (const def of filters) {
      if (!def?.field) continue;
      defs.push({
        field: String(def.field),
        dotWalk: Boolean(def.dotWalk),
      });
    }
    return defs;
  },

  refSysId: function (gr, field) {
    try {
      const v = gr.getValue(field);
      if (v) return String(v);
    } catch (error) { gs.debug('application-home refSysId getValue failed for ' + field + ': ' + error); }
    try {
      const el = gr.getElement(field);
      if (el && !el.nil()) return String(el.toString());
    } catch (error) { gs.debug('application-home refSysId getElement failed for ' + field + ': ' + error); }
    return '';
  },

  safeRefDisplay: function (gr, refField) {
    try {
      const el = gr.getElement(refField);
      if (el && !el.nil()) {
        return String(el.getDisplayValue() || '');
      }
    } catch (error) { gs.debug('application-home safeRefDisplay failed for ' + refField + ': ' + error); }
    return '';
  },

  safeRefField: function (gr, refField, subField) {
    try {
      const el = gr.getElement(refField);
      if (el && !el.nil()) {
        return String(el[subField] || '');
      }
    } catch (error) { gs.debug('application-home safeRefField failed for ' + refField + '.' + subField + ': ' + error); }
    return '';
  },

  /** Mirror client buildRelCiInstanceEdgeQuery — Table API encoded query on cmdb_rel_ci. */
  buildRelCiInstanceEdgeQuery: function (criteria, twoLevel, filterDefs) {
    const parts = [
      twoLevel
        ? 'type.name=Connects to::Connected by'
        : 'type.name=Contains::Contained by',
    ];
    const child = 'child.';
    const childRef = twoLevel ? 'child.ref_cmdb_ci_service.' : 'child.ref_cmdb_ci_service_auto.';
    if (twoLevel) parts.push(childRef + 'u_service_type=instance');

    const q = (criteria.search || '').trim();
    if (q) parts.push(child + 'nameLIKE' + q);

    const defs = filterDefs?.length ? filterDefs : this.getFilterDefsForHierarchy(!twoLevel);
    const filters = criteria.filters || {};
    for (const def of defs) {
      const values = filters[def.field];
      if (!values?.length) continue;
      const prefix = def.dotWalk ? childRef : child;
      parts.push(prefix + def.field + 'IN' + values.join(','));
    }

    return parts.join('^');
  },

  relCiRow: function (gr) {
    return {
      parent: this.refSysId(gr, 'parent'),
      child: this.refSysId(gr, 'child'),
      parentName: this.safeRefDisplay(gr, 'parent'),
      parentShortDescription: this.safeRefField(gr, 'parent', 'short_description'),
    };
  },

  /** Same encoded-query pattern as client chunkedINParallel on cmdb_rel_ci. */
  queryRelCiInChunks: function (inField, ids, extraQuery, rowHandler, logLabel) {
    if (!ids.length) return;
    const chunkSize = this.REL_CI_IN_CHUNK;
    let chunkNum = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunkNum += 1;
      const slice = ids.slice(i, i + chunkSize);
      let encoded = inField + 'IN' + slice.join(',');
      if (extraQuery) encoded += '^' + extraQuery;
      const gr = new GlideRecord('cmdb_rel_ci');
      gr.addEncodedQuery(encoded);
      gr.setLimit(5000);
      gr.query();
      let count = 0;
      while (gr.next()) {
        count += 1;
        rowHandler(this.relCiRow(gr));
      }
      this.logQuery(
        logLabel || 'rel_ci_chunk',
        'table=cmdb_rel_ci chunk=' + chunkNum + '/' + Math.ceil(ids.length / chunkSize)
          + ' id_count=' + slice.length
          + ' rows=' + count
          + ' sysparm_query=' + encoded
      );
    }
  },

  queryTableInChunks: function (table, ids, fields, rowHandler) {
    if (!ids.length) return;
    const chunkSize = 150;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const slice = ids.slice(i, i + chunkSize);
      const gr = new GlideRecord(table);
      gr.addQuery('sys_id', 'IN', slice.join(','));
      gr.query();
      while (gr.next()) {
        const row = {};
        for (const field of fields) {
          row[field] = gr.getValue(field) || gr.getDisplayValue(field) || '';
        }
        rowHandler(row);
      }
    }
  },

  /** Session cache token — gs.generateGUID() is scoped-app safe (no GlideChecksum/GlideDigest). */
  makeFilterToken: function () {
    return gs.generateGUID();
  },

  cacheKey: function (token) {
    return this.CACHE_PREFIX + token;
  },

  storeFilterCache: function (token, families, instanceIds, orphanIds) {
    const data = {
      families: families,
      instance_ids: instanceIds,
      orphan_ids: orphanIds || [],
      created_at: Date.now(),
    };
    gs.getSession().putClientData(this.cacheKey(token), JSON.stringify(data));
  },

  loadFilterCache: function (token) {
    const raw = gs.getSession().getClientData(this.cacheKey(token));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data?.created_at) return null;
      if (Date.now() - data.created_at > this.CACHE_TTL_MS) return null;
      return data;
    } catch (error) {
      gs.debug('application-home loadFilterCache parse failed: ' + error);
      return null;
    }
  },

  unfilteredCacheKey: function (twoLevel) {
    return this.UNFILTERED_CACHE_PREFIX + (twoLevel ? '2l' : '3l');
  },

  storeUnfilteredCache: function (twoLevel, families, orphanIds) {
    gs.getSession().putClientData(this.unfilteredCacheKey(twoLevel), JSON.stringify({
      families: families,
      orphan_ids: orphanIds || [],
      created_at: Date.now(),
    }));
  },

  loadUnfilteredCache: function (twoLevel) {
    const raw = gs.getSession().getClientData(this.unfilteredCacheKey(twoLevel));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data?.created_at || !Array.isArray(data.families)) return null;
      if (Date.now() - data.created_at > this.CACHE_TTL_MS) return null;
      if (!Object.hasOwn(data, 'orphan_ids')) return null;
      return {
        families: data.families,
        orphan_ids: data.orphan_ids || [],
      };
    } catch (error) {
      gs.debug('application-home loadUnfilteredCache parse failed: ' + error);
      return null;
    }
  },

  fetchAllInstanceSysIds: function (twoLevel) {
    const ids = [];
    const table = twoLevel ? 'cmdb_ci_service' : 'cmdb_ci_service_auto';
    const gr = new GlideRecord(table);
    if (twoLevel) gr.addQuery('u_service_type', 'instance');
    gr.query();
    while (gr.next()) ids.push(gr.getUniqueValue());
    return ids;
  },

  /** All app-family / business-app family sys_ids (not just visible/paged families). */
  fetchAllFamilyIds: function (twoLevel) {
    const ids = [];
    const table = twoLevel ? 'cmdb_ci_service' : 'cmdb_ci_business_app';
    const gr = new GlideRecord(table);
    if (twoLevel) gr.addQuery('u_service_type', 'service');
    gr.query();
    while (gr.next()) ids.push(gr.getUniqueValue());
    return ids;
  },

  /** Instance sys_ids reachable from any real app family via hierarchy rel_ci walks. */
  fetchLinkedInstanceIds: function (twoLevel, restrictSet) {
    const linked = {};
    const familyIds = this.fetchAllFamilyIds(twoLevel);
    if (!familyIds.length) return linked;

    const families = [];
    for (const familyId of familyIds) {
      families.push({ sys_id: familyId, name: '', short_description: '' });
    }

    const mapping = twoLevel
      ? this.buildTwoLevelMapping(families, restrictSet)
      : this.buildThreeLevelMapping(families, restrictSet);

    if (!mapping) return linked;
    this._collectInstancesFromMapping(mapping, twoLevel, linked);
    return linked;
  },

  _collectInstancesFromMapping: function (mapping, twoLevel, linked) {
    if (twoLevel) {
      for (const appId in mapping.app_to_instances) {
        if (!mapping.app_to_instances.hasOwnProperty(appId)) continue;
        if (appId === this.OTHERS_FAMILY_ID) continue;
        const instArr = mapping.app_to_instances[appId] || [];
        for (const instId of instArr) linked[instId] = true;
      }
    } else {
      const instIds = mapping.instance_ids || [];
      for (const instId of instIds) linked[instId] = true;
    }
  },

  /** Instances with no app-family link — grouped into [Others] on the home page. */
  computeOrphanInstanceIds: function (twoLevel, restrictSet) {
    const universe = restrictSet ? Object.keys(restrictSet) : this.fetchAllInstanceSysIds(twoLevel);
    if (!universe.length) return [];

    const linked = this.fetchLinkedInstanceIds(twoLevel, restrictSet);
    const orphans = [];
    for (const element of universe) {
      if (!linked[element]) orphans.push(element);
    }
    this.logQuery(
      'orphan_instances',
      'two_level=' + twoLevel
        + ' universe=' + universe.length
        + ' linked=' + Object.keys(linked).length
        + ' orphans=' + orphans.length
    );
    return orphans;
  },

  appendOthersToTwoLevelMapping: function (mapping, orphanIds) {
    if (!orphanIds.length) return mapping;

    if (!mapping) {
      const onlyMeta = {};
      onlyMeta[this.OTHERS_FAMILY_ID] = {
        name: this.OTHERS_FAMILY_NAME,
        short_description: '',
      };
      const onlyMap = {};
      onlyMap[this.OTHERS_FAMILY_ID] = orphanIds.slice();
      return {
        app_family_meta: onlyMeta,
        app_to_instances: onlyMap,
        instance_svc_ids: orphanIds.slice(),
      };
    }

    mapping.app_family_meta[this.OTHERS_FAMILY_ID] = {
      name: this.OTHERS_FAMILY_NAME,
      short_description: '',
    };
    mapping.app_to_instances[this.OTHERS_FAMILY_ID] = orphanIds.slice();

    const instMap = {};
    const existing = mapping.instance_svc_ids || [];
    for (const existingId of existing) instMap[existingId] = true;
    for (const orphanId of orphanIds) instMap[orphanId] = true;
    mapping.instance_svc_ids = Object.keys(instMap);
    return mapping;
  },

  appendOthersToThreeLevelMapping: function (mapping, orphanIds) {
    if (!orphanIds.length) return mapping;

    if (!mapping) {
      const onlySvcMap = {};
      onlySvcMap[this.OTHERS_SVC_ID] = {
        name: this.OTHERS_FAMILY_NAME,
        short_description: '',
      };
      const onlyBAppToSvcs = {};
      onlyBAppToSvcs[this.OTHERS_FAMILY_ID] = [this.OTHERS_SVC_ID];
      const onlySvcToInst = {};
      onlySvcToInst[this.OTHERS_SVC_ID] = orphanIds.slice();
      return {
        b_apps: [{
          sys_id: this.OTHERS_FAMILY_ID,
          name: this.OTHERS_FAMILY_NAME,
          short_description: '',
        }],
        svc_map: onlySvcMap,
        b_app_to_svcs: onlyBAppToSvcs,
        svc_to_inst_ids: onlySvcToInst,
        instance_ids: orphanIds.slice(),
      };
    }

    mapping.svc_map[this.OTHERS_SVC_ID] = {
      name: this.OTHERS_FAMILY_NAME,
      short_description: '',
    };
    mapping.b_app_to_svcs[this.OTHERS_FAMILY_ID] = [this.OTHERS_SVC_ID];
    mapping.svc_to_inst_ids[this.OTHERS_SVC_ID] = orphanIds.slice();

    let hasOthers = false;
    for (const bApp of mapping.b_apps) {
      if (bApp.sys_id === this.OTHERS_FAMILY_ID) {
        hasOthers = true;
        break;
      }
    }
    if (!hasOthers) {
      mapping.b_apps.push({
        sys_id: this.OTHERS_FAMILY_ID,
        name: this.OTHERS_FAMILY_NAME,
        short_description: '',
      });
    }

    const instMap = {};
    const existing = mapping.instance_ids || [];
    for (const existingId of existing) instMap[existingId] = true;
    for (const orphanId of orphanIds) instMap[orphanId] = true;
    mapping.instance_ids = Object.keys(instMap);
    return mapping;
  },

  /** Scan all family rows; return only those with at least one instance (session-cached). */
  resolveUnfilteredVisibleFamilies: function (twoLevel) {
    const cached = this.loadUnfilteredCache(twoLevel);
    if (cached) {
      this.logQuery(
        'unfiltered_cache_hit',
        'families=' + cached.families.length + ' orphans=' + (cached.orphan_ids ? cached.orphan_ids.length : 0)
      );
      return cached;
    }

    const table = twoLevel ? 'cmdb_ci_service' : 'cmdb_ci_business_app';
    const scanBatch = 50;
    let offset = 0;
    let visible = [];
    let tableRowsScanned = 0;

    this.logQuery(
      'unfiltered_visible_scan_start',
      'table=' + table + ' batch=' + scanBatch
    );

    while (true) {
      const batch = this._fetchOneFamilyBatch(table, twoLevel, offset, scanBatch);
      if (!batch.length) break;
      tableRowsScanned += batch.length;
      const mapping = twoLevel
        ? this.buildTwoLevelMapping(batch, null)
        : this.buildThreeLevelMapping(batch, null);
      if (mapping) this._processBatch(mapping, twoLevel, visible);
      offset += batch.length;
      if (batch.length < scanBatch) break;
    }

    visible = this.sortFamilies(visible);
    const orphanIds = this.computeOrphanInstanceIds(twoLevel, null);
    this.storeUnfilteredCache(twoLevel, visible, orphanIds);
    this.logQuery(
      'unfiltered_visible_scan_result',
      'table_rows_scanned=' + tableRowsScanned
        + ' visible_families=' + visible.length
        + ' orphan_instances=' + orphanIds.length
    );
    return { families: visible, orphan_ids: orphanIds };
  },

  _fetchOneFamilyBatch: function (table, twoLevel, offset, limit) {
    const gr = new GlideRecord(table);
    if (twoLevel) gr.addQuery('u_service_type', 'service');
    gr.orderBy('name');
    gr.chooseWindow(offset, offset + limit);
    gr.query();
    const batch = [];
    while (gr.next()) {
      batch.push({
        sys_id: gr.getUniqueValue(),
        name: gr.getValue('name') || gr.getDisplayValue('name') || gr.getUniqueValue(),
        short_description: gr.getValue('short_description') || '',
      });
    }
    return batch;
  },

  _processBatch: function (mapping, twoLevel, visible) {
    if (twoLevel) {
      for (const appId in mapping.app_family_meta) {
        if (!mapping.app_family_meta.hasOwnProperty(appId)) continue;
        if (appId === this.OTHERS_FAMILY_ID) continue;
        const meta = mapping.app_family_meta[appId];
        visible.push({ sys_id: appId, name: meta.name, short_description: meta.short_description || '' });
      }
    } else {
      for (const bApp of mapping.b_apps) {
        if (bApp.sys_id === this.OTHERS_FAMILY_ID) continue;
        visible.push(bApp);
      }
    }
  },

  sortFamilies: function (families) {
    families.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return families;
  },

  queryFilteredInstanceEdges: function (criteria, twoLevel, filterDefs, limit, offset) {
    const rows = [];
    const encoded = this.buildRelCiInstanceEdgeQuery(criteria, twoLevel, filterDefs);
    const gr = new GlideRecord('cmdb_rel_ci');
    gr.addEncodedQuery(encoded);
    gr.orderBy('child.name');
    if (offset !== undefined && limit !== undefined) {
      gr.chooseWindow(offset, offset + limit);
    } else if (limit) {
      gr.setLimit(limit);
    }
    this.logQuery(
      'filter_edge_query',
      'table=cmdb_rel_ci offset=' + (offset || 0) + ' limit=' + (limit || 'none')
        + ' sysparm_query=' + encoded
    );
    gr.query();
    while (gr.next()) {
      rows.push(this.relCiRow(gr));
    }
    this.logQuery(
      'filter_edge_result',
      'offset=' + (offset || 0) + ' rows=' + rows.length
        + ' sample_child=' + (rows.length ? rows[0].child : '')
        + ' sample_parent=' + (rows.length ? rows[0].parent : '')
    );
    return rows;
  },

  _applyFamilyHopRow: function (row, familyMap) {
    if (!row.parent || familyMap[row.parent]) return;
    familyMap[row.parent] = {
      sys_id: row.parent,
      name: row.parentName || row.parent,
      short_description: row.parentShortDescription || '',
    };
  },

  _collectEdgeIdMaps: function (criteria, twoLevel, filterDefs) {
    const childMap = {};
    const parentMap = {};
    let offset = 0;
    let truncated = false;
    let totalEdges = 0;
    while (true) {
      const batch = this.queryFilteredInstanceEdges(criteria, twoLevel, filterDefs, this.EDGE_BATCH, offset);
      if (!batch.length) break;
      for (const row of batch) {
        if (row.child) childMap[row.child] = true;
        if (row.parent) parentMap[row.parent] = true;
      }
      totalEdges += batch.length;
      offset += batch.length;
      if (batch.length < this.EDGE_BATCH) break;
      if (totalEdges >= this.MAX_EDGES) { truncated = true; break; }
    }
    return { childIds: Object.keys(childMap), parentIds: Object.keys(parentMap), truncated: truncated, totalEdges: totalEdges };
  },

  resolveFilteredTwoLevel: function (criteria, filterDefs) {
    const edges = this._collectEdgeIdMaps(criteria, true, filterDefs);
    const instanceIds = edges.childIds;
    const intermediateIds = edges.parentIds;
    const truncated = edges.truncated;
    this.logQuery(
      'resolve_2level_summary',
      'total_edges=' + edges.totalEdges + ' instance_ids=' + instanceIds.length
        + ' intermediate_ids=' + intermediateIds.length + ' truncated=' + truncated
    );
    if (!intermediateIds.length) {
      return { access: 'ok', families: [], instance_ids: instanceIds, truncated: truncated };
    }

    // u_service_type exists only on cmdb_ci_service — parent is the app-family service CI.
    const hopExtraQuery =
      'type.name=Connects to::Connected by^parent.ref_cmdb_ci_service.u_service_type=service';
    this.logQuery(
      'resolve_2level_hop_query',
      'intermediate_count=' + intermediateIds.length
        + ' intermediate_ids=' + intermediateIds.join(',')
        + ' sysparm_query=child.sys_idIN' + intermediateIds.join(',')
        + '^' + hopExtraQuery
    );

    const familyMap = {};
    this.queryRelCiInChunks(
      'child.sys_id',
      intermediateIds,
      hopExtraQuery,
      (row) => { this._applyFamilyHopRow(row, familyMap); },
      'resolve_2level_hop'
    );

    const families = [];
    for (const fid in familyMap) {
      if (familyMap.hasOwnProperty(fid)) families.push(familyMap[fid]);
    }

    this.logQuery(
      'resolve_2level_hop_result',
      'families_found=' + families.length
        + (families.length
          ? ' sample_family=' + families[0].sys_id + ' name=' + families[0].name
          : '')
    );

    return {
      access: 'ok',
      families: this.sortFamilies(families),
      instance_ids: instanceIds,
      truncated: truncated,
    };
  },

  resolveFilteredThreeLevel: function (criteria, filterDefs) {
    const edges = this._collectEdgeIdMaps(criteria, false, filterDefs);
    const instanceIds = edges.childIds;
    const serviceIds = edges.parentIds;
    const truncated = edges.truncated;
    this.logQuery(
      'resolve_3level_summary',
      'total_edges=' + edges.totalEdges + ' instance_ids=' + instanceIds.length
        + ' service_ids=' + serviceIds.length + ' truncated=' + truncated
    );
    if (!serviceIds.length) {
      return { access: 'ok', families: [], instance_ids: instanceIds, truncated: truncated };
    }

    const familyMap = {};
    this.queryRelCiInChunks(
      'child.sys_id',
      serviceIds,
      'type.name=Consumes::Consumed by',
      (row) => { this._applyFamilyHopRow(row, familyMap); },
      'resolve_3level_hop'
    );

    const families = [];
    for (const fid in familyMap) {
      if (familyMap.hasOwnProperty(fid)) families.push(familyMap[fid]);
    }

    return {
      access: 'ok',
      families: this.sortFamilies(families),
      instance_ids: instanceIds,
      truncated: truncated,
    };
  },

  fetchUnfilteredFamilies: function (twoLevel, page, pageSize) {
    const table = twoLevel ? 'cmdb_ci_service' : 'cmdb_ci_business_app';
    const encoded = twoLevel ? 'u_service_type=service' : '';
    this.logQuery(
      'unfiltered_families_query',
      'table=' + table + ' page=' + page + ' page_size=' + pageSize
        + ' sysparm_query=' + encoded + '^ORDERBYname'
    );
    const gr = new GlideRecord(table);
    if (twoLevel) gr.addQuery('u_service_type', 'service');

    const ga = new GlideAggregate(table);
    if (twoLevel) ga.addQuery('u_service_type', 'service');
    ga.addAggregate('COUNT');
    ga.query();
    let totalFamilies = 0;
    if (ga.next()) totalFamilies = Number.parseInt(ga.getAggregate('COUNT'), 10) || 0;

    gr.orderBy('name');
    gr.chooseWindow(page * pageSize, (page + 1) * pageSize);
    gr.query();

    const families = [];
    while (gr.next()) {
      families.push({
        sys_id: gr.getUniqueValue(),
        name: gr.getValue('name') || gr.getDisplayValue('name') || gr.getUniqueValue(),
        short_description: gr.getValue('short_description') || '',
      });
    }

    this.logQuery(
      'unfiltered_families_result',
      'table=' + table + ' page_rows=' + families.length + ' total_families=' + totalFamilies
    );

    return { access: 'ok', families: families, totalFamilies: totalFamilies };
  },

  _applyHopRow: function (row, hopMap) {
    if (!row.parent || !row.child) return;
    if (!hopMap[row.parent]) hopMap[row.parent] = [];
    hopMap[row.parent].push(row.child);
  },

  buildTwoLevelMapping: function (families, restrictSet) {
    if (!families.length) return null;

    const appFamilyMeta = {};
    const familyIds = [];
    for (const f of families) {
      appFamilyMeta[f.sys_id] = {
        name: f.name,
        short_description: f.short_description || '',
      };
      familyIds.push(f.sys_id);
    }

    const hop1Map = {};
    this.queryRelCiInChunks(
      'parent.sys_id',
      familyIds,
      'type.name=Connects to::Connected by',
      (row) => { this._applyHopRow(row, hop1Map); },
      'mapping_2level_hop1'
    );

    const intermediateIds = [];
    const seenInt = {};
    for (const pid in hop1Map) {
      if (!hop1Map.hasOwnProperty(pid)) continue;
      const ints = hop1Map[pid];
      for (const int of ints) {
        if (!seenInt[int]) {
          seenInt[int] = true;
          intermediateIds.push(int);
        }
      }
    }

    const hop2Map = {};
    if (intermediateIds.length) {
      this.queryRelCiInChunks(
        'parent.sys_id',
        intermediateIds,
        'type.name=Connects to::Connected by^child.ref_cmdb_ci_service.u_service_type=instance',
        (row) => { this._applyHopRow(row, hop2Map); },
        'mapping_2level_hop2'
      );
    }

    const appToInstances = this._buildAppToInstances(familyIds, hop1Map, hop2Map, restrictSet);
    return this._pruneTwoLevelResult(familyIds, appToInstances, appFamilyMeta);
  },

  _buildAppToInstances: function (familyIds, hop1Map, hop2Map, restrictSet) {
    const appToInstances = {};
    for (const appId of familyIds) {
      const instList = [];
      const instSeen = {};
      for (const mid of (hop1Map[appId] || [])) {
        for (const instId of (hop2Map[mid] || [])) {
          if (restrictSet && !restrictSet[instId]) continue;
          if (!instSeen[instId]) {
            instSeen[instId] = true;
            instList.push(instId);
          }
        }
      }
      appToInstances[appId] = instList;
    }
    return appToInstances;
  },

  _pruneTwoLevelResult: function (familyIds, appToInstances, appFamilyMeta) {
    const prunedMeta = {};
    const prunedMap = {};
    const prunedInstMap = {};
    for (const fid of familyIds) {
      const insts = appToInstances[fid] || [];
      if (!insts.length) continue;
      prunedMeta[fid] = appFamilyMeta[fid];
      prunedMap[fid] = insts;
      for (const instId of insts) prunedInstMap[instId] = true;
    }
    if (!Object.keys(prunedMap).length) return null;
    return {
      app_family_meta: prunedMeta,
      app_to_instances: prunedMap,
      instance_svc_ids: Object.keys(prunedInstMap),
    };
  },

  _applySvcMetaRow: function (row, svcMap) {
    svcMap[row.sys_id] = {
      name: row.name || row.sys_id,
      short_description: row.short_description || '',
    };
  },

  buildThreeLevelMapping: function (bApps, restrictSet) {
    if (!bApps.length) return null;

    const bAppIds = [];
    for (const bApp of bApps) bAppIds.push(bApp.sys_id);

    const consumesRows = [];
    this.queryRelCiInChunks(
      'parent.sys_id',
      bAppIds,
      'type.name=Consumes::Consumed by',
      function (row) { consumesRows.push(row); },
      'mapping_3level_consumes'
    );

    const serviceIdMap = {};
    for (const consumesRow of consumesRows) {
      if (consumesRow.child) serviceIdMap[consumesRow.child] = true;
    }
    const serviceIds = Object.keys(serviceIdMap);

    const svcMap = {};
    if (serviceIds.length) {
      this.queryTableInChunks(
        'cmdb_ci_service',
        serviceIds,
        ['sys_id', 'name', 'short_description'],
        (row) => { this._applySvcMetaRow(row, svcMap); }
      );
    }

    const containsRows = [];
    if (serviceIds.length) {
      this.queryRelCiInChunks(
        'parent.sys_id',
        serviceIds,
        'type.name=Contains::Contained by',
        function (row) { containsRows.push(row); },
        'mapping_3level_contains'
      );
    }

    const bAppToSvcs = this._buildBAppToSvcs(consumesRows);
    const svcToInstIds = this._buildSvcToInstIds(containsRows, restrictSet);
    return this._pruneThreeLevelResult(bApps, bAppToSvcs, svcToInstIds, svcMap);
  },

  _buildBAppToSvcs: function (consumesRows) {
    const bAppToSvcs = {};
    for (const row of consumesRows) {
      const b = row.parent, s = row.child;
      if (!b || !s) continue;
      if (!bAppToSvcs[b]) bAppToSvcs[b] = [];
      bAppToSvcs[b].push(s);
    }
    return bAppToSvcs;
  },

  _buildSvcToInstIds: function (containsRows, restrictSet) {
    const svcToInstIds = {};
    for (const row of containsRows) {
      const svc = row.parent, inst = row.child;
      if (!svc || !inst) continue;
      if (restrictSet && !restrictSet[inst]) continue;
      if (!svcToInstIds[svc]) svcToInstIds[svc] = [];
      svcToInstIds[svc].push(inst);
    }
    return svcToInstIds;
  },

  _pruneThreeLevelResult: function (bApps, bAppToSvcs, svcToInstIds, svcMap) {
    const prunedSvcToInstIds = {};
    for (const svcId in svcToInstIds) {
      if (svcToInstIds.hasOwnProperty(svcId) && svcToInstIds[svcId].length) {
        prunedSvcToInstIds[svcId] = svcToInstIds[svcId];
      }
    }

    const prunedBAppToSvcs = {};
    const visibleBApps = [];
    for (const app of bApps) {
      const visibleSvcs = (bAppToSvcs[app.sys_id] || []).filter(s => prunedSvcToInstIds[s]);
      if (!visibleSvcs.length) continue;
      visibleBApps.push(app);
      prunedBAppToSvcs[app.sys_id] = visibleSvcs;
    }
    if (!visibleBApps.length) return null;

    const instanceIdMap = {};
    for (const svcKey in prunedSvcToInstIds) {
      if (prunedSvcToInstIds.hasOwnProperty(svcKey)) {
        for (const instId of prunedSvcToInstIds[svcKey]) instanceIdMap[instId] = true;
      }
    }

    return {
      b_apps: visibleBApps,
      svc_map: svcMap,
      b_app_to_svcs: prunedBAppToSvcs,
      svc_to_inst_ids: prunedSvcToInstIds,
      instance_ids: Object.keys(instanceIdMap),
    };
  },

  sliceFamilies: function (families, page, pageSize) {
    const start = page * pageSize;
    return families.slice(start, start + pageSize);
  },

  restrictSetFromArray: function (ids) {
    const set = {};
    for (const id of ids) set[id] = true;
    return set;
  },

  _handleFilteredRequest: function (twoLevel, criteria, filterDefs, filterToken, cache) {
    // Empty families + non-empty instance_ids is a stale/broken cache (e.g. hop dot-walk fix).
    const cacheUsable = cache
      && Array.isArray(cache.families)
      && (cache.families.length > 0 || !(cache.instance_ids?.length));
    if (cacheUsable) {
      const families = cache.families;
      const instanceIds = cache.instance_ids || [];
      const orphanIds = Object.hasOwn(cache, 'orphan_ids')
        ? (cache.orphan_ids || [])
        : this.computeOrphanInstanceIds(twoLevel, this.restrictSetFromArray(instanceIds));
      this.logQuery(
        'filter_cache_hit',
        'families=' + families.length + ' instance_ids=' + instanceIds.length + ' orphans=' + orphanIds.length
      );
      return { families: families, totalFamilies: families.length, instanceIds: instanceIds, orphanIds: orphanIds, truncated: false, resultToken: filterToken };
    }
    if (cache) {
      this.logQuery('filter_cache_skip', 'reason=instance_ids_without_families instance_ids=' + ((cache.instance_ids?.length) || 0));
    }
    const resolved = twoLevel
      ? this.resolveFilteredTwoLevel(criteria, filterDefs)
      : this.resolveFilteredThreeLevel(criteria, filterDefs);
    const families = resolved.families || [];
    const instanceIds = resolved.instance_ids || [];
    const orphanIds = this.computeOrphanInstanceIds(twoLevel, this.restrictSetFromArray(instanceIds));
    const resultToken = this.makeFilterToken();
    this.storeFilterCache(resultToken, families, instanceIds, orphanIds);
    return { families: families, totalFamilies: families.length, instanceIds: instanceIds, orphanIds: orphanIds, truncated: resolved.truncated || false, resultToken: resultToken };
  },

  _buildPageMapping: function (twoLevel, pageFamilies, restrictSet, orphanIds) {
    let mapping = twoLevel
      ? this.buildTwoLevelMapping(pageFamilies, restrictSet)
      : this.buildThreeLevelMapping(pageFamilies, restrictSet);
    if (orphanIds.length) {
      mapping = twoLevel
        ? this.appendOthersToTwoLevelMapping(mapping, orphanIds)
        : this.appendOthersToThreeLevelMapping(mapping, orphanIds);
    }
    return mapping;
  },

  _parsePaginationParams: function (body) {
    let page = Number.parseInt(this.readField(body, 'page') || '0', 10);
    if (Number.isNaN(page) || page < 0) page = 0;
    let pageSize = Number.parseInt(this.readField(body, 'page_size') || String(this.DEFAULT_PAGE_SIZE), 10);
    if (Number.isNaN(pageSize) || pageSize < 1) pageSize = this.DEFAULT_PAGE_SIZE;
    if (pageSize > 200) pageSize = 200;
    return { page: page, pageSize: pageSize };
  },

  _handleUnfilteredRequest: function (twoLevel) {
    const unfiltered = this.resolveUnfilteredVisibleFamilies(twoLevel);
    const families = unfiltered.families || [];
    const orphanIds = unfiltered.orphan_ids || [];
    return { families: families, totalFamilies: families.length, instanceIds: [], orphanIds: orphanIds };
  },

  handlePost: function (request, response) {
    try {
      const body = this.parseBody(request);
      if (body === null) {
        this.jsonError(response, 400, 'Invalid JSON body');
        return;
      }

      const hierarchyMode = this.readField(body, 'hierarchy_mode');
      if (hierarchyMode !== 'two_level' && hierarchyMode !== 'three_level') {
        this.jsonError(response, 400, 'hierarchy_mode must be two_level or three_level');
        return;
      }

      const twoLevel = hierarchyMode === 'two_level';
      const filterDefs = this.getFilterDefsForHierarchy(!twoLevel);
      const criteria = this.normalizeCriteria(body);
      const { page, pageSize } = this._parsePaginationParams(body);
      const filterToken = this.readField(body, 'filter_token');
      const filtersActive = this.hasActiveFilters(criteria);
      this.logQuery(
        'request',
        'hierarchy_mode=' + hierarchyMode
          + ' filters_active=' + filtersActive
          + ' page=' + page
          + ' page_size=' + pageSize
          + ' filter_token=' + (filterToken || '')
          + ' criteria=' + JSON.stringify(criteria)
      );
      let families, totalFamilies, instanceIds, orphanIds, truncated, resultToken;

      if (filtersActive) {
        const cache = filterToken ? this.loadFilterCache(filterToken) : null;
        const r = this._handleFilteredRequest(twoLevel, criteria, filterDefs, filterToken, cache);
        families = r.families;
        totalFamilies = r.totalFamilies;
        instanceIds = r.instanceIds;
        orphanIds = r.orphanIds;
        truncated = r.truncated;
        resultToken = r.resultToken;
      } else {
        const r = this._handleUnfilteredRequest(twoLevel);
        families = r.families;
        totalFamilies = r.totalFamilies;
        instanceIds = r.instanceIds;
        orphanIds = r.orphanIds;
        truncated = false;
        resultToken = null;
      }
      const pageFamilies = this.sliceFamilies(families, page, pageSize);

      const restrictSet = filtersActive ? this.restrictSetFromArray(instanceIds) : null;
      const mapping = this._buildPageMapping(twoLevel, pageFamilies, restrictSet, orphanIds);

      const access = (!mapping && pageFamilies.length > 0 && !orphanIds.length) ? 'error' : 'ok';

      this.logQuery(
        'response',
        'access=' + access
          + ' filters_active=' + filtersActive
          + ' total_families=' + totalFamilies
          + ' instance_ids=' + instanceIds.length
          + ' page_families=' + pageFamilies.length
          + ' mapping=' + (mapping ? 'yes' : 'no')
          + ' filter_token=' + (resultToken || '')
      );

      this.jsonOk(response, {
        access: access,
        hierarchy_mode: hierarchyMode,
        page: page,
        page_size: pageSize,
        total_families: totalFamilies,
        filter_token: resultToken,
        instance_ids: instanceIds,
        mapping: mapping,
        truncated: truncated,
      });
    } catch (error) {
      this.jsonError(response, 500, this.scriptError(error));
    }
  },

  type: 'ApplicationHomeHandler',
};
