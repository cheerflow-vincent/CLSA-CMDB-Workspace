var ApplicationHomeHandler = Class.create();
ApplicationHomeHandler.prototype = {
  initialize: function () {},

  REL_CI_IN_CHUNK: 50,
  EDGE_BATCH: 100,
  MAX_EDGES: 50000,
  CACHE_PREFIX: 'clsa_app_home_filter_',
  CACHE_TTL_MS: 15 * 60 * 1000,
  DEFAULT_PAGE_SIZE: 50,

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

  readStringArray: function (obj, name) {
    var raw = obj[name];
    if (!raw) return [];
    if (Array.isArray(raw)) {
      var out = [];
      for (var i = 0; i < raw.length; i++) {
        var s = this.sn(raw[i]);
        if (s) out.push(s);
      }
      return out;
    }
    var single = this.sn(raw);
    return single ? [single] : [];
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

  parseBody: function (request) {
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

      // Some instances expose POST JSON fields directly on the wrapper object.
      if (this.readField(wrapper, 'hierarchy_mode')) return wrapper;

      return {};
    } catch (e) {
      return null;
    }
  },

  normalizeCriteria: function (body) {
    return {
      search: this.readField(body, 'search'),
      env: this.readStringArray(body, 'env'),
      status: this.readStringArray(body, 'status'),
      dept: this.readStringArray(body, 'dept'),
      biz_unit: this.readStringArray(body, 'biz_unit'),
      tier: this.readStringArray(body, 'tier'),
    };
  },

  hasActiveFilters: function (criteria) {
    return Boolean(
      (criteria.search && criteria.search.trim())
      || criteria.env.length
      || criteria.status.length
      || criteria.dept.length
      || criteria.biz_unit.length
      || criteria.tier.length
    );
  },

  refSysId: function (gr, field) {
    try {
      var v = gr.getValue(field);
      if (v) return String(v);
    } catch (e1) {}
    try {
      var el = gr.getElement(field);
      if (el && !el.nil()) return String(el.toString());
    } catch (e2) {}
    return '';
  },

  safeRefDisplay: function (gr, refField) {
    try {
      var el = gr.getElement(refField);
      if (el && !el.nil()) {
        return String(el.getDisplayValue() || '');
      }
    } catch (e) {}
    return '';
  },

  safeRefField: function (gr, refField, subField) {
    try {
      var el = gr.getElement(refField);
      if (el && !el.nil()) {
        return String(el[subField] || '');
      }
    } catch (e) {}
    return '';
  },

  /** Mirror client buildRelCiInstanceEdgeQuery — Table API encoded query on cmdb_rel_ci. */
  buildRelCiInstanceEdgeQuery: function (criteria, twoLevel) {
    var parts = [
      twoLevel
        ? 'type.name=Connects to::Connected by'
        : 'type.name=Contains::Contained by',
    ];
    var child = 'child.';
    if (twoLevel) parts.push(child + 'u_service_type=instance');

    var q = (criteria.search || '').trim();
    if (q) parts.push(child + 'nameLIKE' + q);
    if (criteria.env.length) parts.push(child + 'environmentIN' + criteria.env.join(','));
    if (criteria.status.length) parts.push(child + 'operational_statusIN' + criteria.status.join(','));
    if (criteria.dept.length) parts.push(child + 'departmentIN' + criteria.dept.join(','));
    if (criteria.biz_unit.length) parts.push(child + 'business_unitIN' + criteria.biz_unit.join(','));
    if (criteria.tier.length) parts.push(child + 'u_tierIN' + criteria.tier.join(','));

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
  queryRelCiInChunks: function (inField, ids, extraQuery, rowHandler) {
    if (!ids.length) return 'ok';
    var chunkSize = this.REL_CI_IN_CHUNK;
    var self = this;
    for (var i = 0; i < ids.length; i += chunkSize) {
      var slice = ids.slice(i, i + chunkSize);
      var encoded = inField + 'IN' + slice.join(',');
      if (extraQuery) encoded += '^' + extraQuery;
      var gr = new GlideRecord('cmdb_rel_ci');
      gr.addEncodedQuery(encoded);
      gr.setLimit(5000);
      gr.query();
      while (gr.next()) {
        rowHandler(self.relCiRow(gr));
      }
    }
    return 'ok';
  },

  queryTableInChunks: function (table, ids, fields, rowHandler) {
    if (!ids.length) return 'ok';
    var chunkSize = 150;
    for (var i = 0; i < ids.length; i += chunkSize) {
      var slice = ids.slice(i, i + chunkSize);
      var gr = new GlideRecord(table);
      gr.addQuery('sys_id', 'IN', slice.join(','));
      gr.query();
      while (gr.next()) {
        var row = {};
        for (var f = 0; f < fields.length; f++) {
          var field = fields[f];
          row[field] = gr.getValue(field) || gr.getDisplayValue(field) || '';
        }
        rowHandler(row);
      }
    }
    return 'ok';
  },

  /** Session cache token — gs.generateGUID() is scoped-app safe (no GlideChecksum/GlideDigest). */
  makeFilterToken: function () {
    return gs.generateGUID();
  },

  cacheKey: function (token) {
    return this.CACHE_PREFIX + token;
  },

  storeFilterCache: function (token, families, instanceIds) {
    var data = {
      families: families,
      instance_ids: instanceIds,
      created_at: new Date().getTime(),
    };
    gs.getSession().putClientData(this.cacheKey(token), JSON.stringify(data));
  },

  loadFilterCache: function (token) {
    var raw = gs.getSession().getClientData(this.cacheKey(token));
    if (!raw) return null;
    try {
      var data = JSON.parse(raw);
      if (!data || !data.created_at) return null;
      if (new Date().getTime() - data.created_at > this.CACHE_TTL_MS) return null;
      return data;
    } catch (e) {
      return null;
    }
  },

  sortFamilies: function (families) {
    families.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return families;
  },

  queryFilteredInstanceEdges: function (criteria, twoLevel, limit, offset) {
    var rows = [];
    var gr = new GlideRecord('cmdb_rel_ci');
    gr.addEncodedQuery(this.buildRelCiInstanceEdgeQuery(criteria, twoLevel));
    gr.orderBy('child.name');
    if (offset !== undefined && limit !== undefined) {
      gr.chooseWindow(offset, offset + limit);
    } else if (limit) {
      gr.setLimit(limit);
    }
    gr.query();
    while (gr.next()) {
      rows.push(this.relCiRow(gr));
    }
    return rows;
  },

  resolveFilteredTwoLevel: function (criteria) {
    var instanceIdMap = {};
    var intermediateIdMap = {};
    var offset = 0;
    var truncated = false;
    var totalEdges = 0;

    while (true) {
      var batch = this.queryFilteredInstanceEdges(criteria, true, this.EDGE_BATCH, offset);
      if (!batch.length) break;

      for (var i = 0; i < batch.length; i++) {
        var row = batch[i];
        if (row.child) instanceIdMap[row.child] = true;
        if (row.parent) intermediateIdMap[row.parent] = true;
      }

      totalEdges += batch.length;
      offset += batch.length;
      if (batch.length < this.EDGE_BATCH) break;
      if (totalEdges >= this.MAX_EDGES) {
        truncated = true;
        break;
      }
    }

    var instanceIds = Object.keys(instanceIdMap);
    var intermediateIds = Object.keys(intermediateIdMap);
    if (!intermediateIds.length) {
      return { access: 'ok', families: [], instance_ids: instanceIds, truncated: truncated };
    }

    var familyMap = {};
    this.queryRelCiInChunks(
      'child.sys_id',
      intermediateIds,
      'type.name=Connects to::Connected by^parent.u_service_type=service',
      function (row) {
        if (!row.parent || familyMap[row.parent]) return;
        familyMap[row.parent] = {
          sys_id: row.parent,
          name: row.parentName || row.parent,
          short_description: row.parentShortDescription || '',
        };
      }
    );

    var families = [];
    for (var fid in familyMap) {
      if (familyMap.hasOwnProperty(fid)) families.push(familyMap[fid]);
    }

    return {
      access: 'ok',
      families: this.sortFamilies(families),
      instance_ids: instanceIds,
      truncated: truncated,
    };
  },

  resolveFilteredThreeLevel: function (criteria) {
    var instanceIdMap = {};
    var serviceIdMap = {};
    var offset = 0;
    var truncated = false;
    var totalEdges = 0;

    while (true) {
      var batch = this.queryFilteredInstanceEdges(criteria, false, this.EDGE_BATCH, offset);
      if (!batch.length) break;

      for (var i = 0; i < batch.length; i++) {
        var row = batch[i];
        if (row.child) instanceIdMap[row.child] = true;
        if (row.parent) serviceIdMap[row.parent] = true;
      }

      totalEdges += batch.length;
      offset += batch.length;
      if (batch.length < this.EDGE_BATCH) break;
      if (totalEdges >= this.MAX_EDGES) {
        truncated = true;
        break;
      }
    }

    var instanceIds = Object.keys(instanceIdMap);
    var serviceIds = Object.keys(serviceIdMap);
    if (!serviceIds.length) {
      return { access: 'ok', families: [], instance_ids: instanceIds, truncated: truncated };
    }

    var familyMap = {};
    this.queryRelCiInChunks(
      'child.sys_id',
      serviceIds,
      'type.name=Consumes::Consumed by',
      function (row) {
        if (!row.parent || familyMap[row.parent]) return;
        familyMap[row.parent] = {
          sys_id: row.parent,
          name: row.parentName || row.parent,
          short_description: row.parentShortDescription || '',
        };
      }
    );

    var families = [];
    for (var fid in familyMap) {
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
    var table = twoLevel ? 'cmdb_ci_service' : 'cmdb_ci_business_app';
    var gr = new GlideRecord(table);
    if (twoLevel) gr.addQuery('u_service_type', 'service');

    var ga = new GlideAggregate(table);
    if (twoLevel) ga.addQuery('u_service_type', 'service');
    ga.addAggregate('COUNT');
    ga.query();
    var totalFamilies = 0;
    if (ga.next()) totalFamilies = parseInt(ga.getAggregate('COUNT'), 10) || 0;

    gr.orderBy('name');
    gr.chooseWindow(page * pageSize, (page + 1) * pageSize);
    gr.query();

    var families = [];
    while (gr.next()) {
      families.push({
        sys_id: gr.getUniqueValue(),
        name: gr.getValue('name') || gr.getDisplayValue('name') || gr.getUniqueValue(),
        short_description: gr.getValue('short_description') || '',
      });
    }

    return { access: 'ok', families: families, totalFamilies: totalFamilies };
  },

  buildTwoLevelMapping: function (families, restrictSet) {
    if (!families.length) return null;

    var appFamilyMeta = {};
    var familyIds = [];
    for (var i = 0; i < families.length; i++) {
      var f = families[i];
      appFamilyMeta[f.sys_id] = {
        name: f.name,
        short_description: f.short_description || '',
      };
      familyIds.push(f.sys_id);
    }

    var hop1Map = {};
    this.queryRelCiInChunks(
      'parent.sys_id',
      familyIds,
      'type.name=Connects to::Connected by',
      function (row) {
        if (!row.parent || !row.child) return;
        if (!hop1Map[row.parent]) hop1Map[row.parent] = [];
        hop1Map[row.parent].push(row.child);
      }
    );

    var intermediateIds = [];
    var seenInt = {};
    for (var pid in hop1Map) {
      if (!hop1Map.hasOwnProperty(pid)) continue;
      var ints = hop1Map[pid];
      for (var j = 0; j < ints.length; j++) {
        if (!seenInt[ints[j]]) {
          seenInt[ints[j]] = true;
          intermediateIds.push(ints[j]);
        }
      }
    }

    var hop2Map = {};
    if (intermediateIds.length) {
      this.queryRelCiInChunks(
        'parent.sys_id',
        intermediateIds,
        'type.name=Connects to::Connected by^child.u_service_type=instance',
        function (row) {
          if (!row.parent || !row.child) return;
          if (!hop2Map[row.parent]) hop2Map[row.parent] = [];
          hop2Map[row.parent].push(row.child);
        }
      );
    }

    var appToInstances = {};
    var instanceSvcIdMap = {};
    for (var fi = 0; fi < familyIds.length; fi++) {
      var appId = familyIds[fi];
      var instList = [];
      var instSeen = {};
      var mids = hop1Map[appId] || [];
      for (var mi = 0; mi < mids.length; mi++) {
        var instIds = hop2Map[mids[mi]] || [];
        for (var ii = 0; ii < instIds.length; ii++) {
          var instId = instIds[ii];
          if (restrictSet && !restrictSet[instId]) continue;
          if (!instSeen[instId]) {
            instSeen[instId] = true;
            instList.push(instId);
            instanceSvcIdMap[instId] = true;
          }
        }
      }
      appToInstances[appId] = instList;
    }

    return {
      app_family_meta: appFamilyMeta,
      app_to_instances: appToInstances,
      instance_svc_ids: Object.keys(instanceSvcIdMap),
    };
  },

  buildThreeLevelMapping: function (bApps, restrictSet) {
    if (!bApps.length) return null;

    var bAppIds = [];
    for (var i = 0; i < bApps.length; i++) bAppIds.push(bApps[i].sys_id);

    var consumesRows = [];
    this.queryRelCiInChunks(
      'parent.sys_id',
      bAppIds,
      'type.name=Consumes::Consumed by',
      function (row) {
        consumesRows.push(row);
      }
    );

    var serviceIdMap = {};
    for (var cr = 0; cr < consumesRows.length; cr++) {
      if (consumesRows[cr].child) serviceIdMap[consumesRows[cr].child] = true;
    }
    var serviceIds = Object.keys(serviceIdMap);

    var svcMap = {};
    if (serviceIds.length) {
      this.queryTableInChunks(
        'cmdb_ci_service',
        serviceIds,
        ['sys_id', 'name', 'short_description'],
        function (row) {
          svcMap[row.sys_id] = {
            name: row.name || row.sys_id,
            short_description: row.short_description || '',
          };
        }
      );
    }

    var containsRows = [];
    if (serviceIds.length) {
      this.queryRelCiInChunks(
        'parent.sys_id',
        serviceIds,
        'type.name=Contains::Contained by',
        function (row) {
          containsRows.push(row);
        }
      );
    }

    var bAppToSvcs = {};
    for (var c1 = 0; c1 < consumesRows.length; c1++) {
      var b = consumesRows[c1].parent;
      var s = consumesRows[c1].child;
      if (!b || !s) continue;
      if (!bAppToSvcs[b]) bAppToSvcs[b] = [];
      bAppToSvcs[b].push(s);
    }

    var svcToInstIds = {};
    var instanceIdMap = {};
    for (var c2 = 0; c2 < containsRows.length; c2++) {
      var svc = containsRows[c2].parent;
      var inst = containsRows[c2].child;
      if (!svc || !inst) continue;
      if (restrictSet && !restrictSet[inst]) continue;
      if (!svcToInstIds[svc]) svcToInstIds[svc] = [];
      svcToInstIds[svc].push(inst);
      instanceIdMap[inst] = true;
    }

    return {
      b_apps: bApps,
      svc_map: svcMap,
      b_app_to_svcs: bAppToSvcs,
      svc_to_inst_ids: svcToInstIds,
      instance_ids: Object.keys(instanceIdMap),
    };
  },

  sliceFamilies: function (families, page, pageSize) {
    var start = page * pageSize;
    return families.slice(start, start + pageSize);
  },

  restrictSetFromArray: function (ids) {
    var set = {};
    for (var i = 0; i < ids.length; i++) set[ids[i]] = true;
    return set;
  },

  handlePost: function (request, response) {
    try {
      var body = this.parseBody(request);
      if (body === null) {
        this.jsonError(response, 400, 'Invalid JSON body');
        return;
      }

      var hierarchyMode = this.readField(body, 'hierarchy_mode');
      if (hierarchyMode !== 'two_level' && hierarchyMode !== 'three_level') {
        this.jsonError(response, 400, 'hierarchy_mode must be two_level or three_level');
        return;
      }

      var twoLevel = hierarchyMode === 'two_level';
      var criteria = this.normalizeCriteria(body);
      var page = parseInt(this.readField(body, 'page') || '0', 10);
      if (isNaN(page) || page < 0) page = 0;

      var pageSize = parseInt(this.readField(body, 'page_size') || String(this.DEFAULT_PAGE_SIZE), 10);
      if (isNaN(pageSize) || pageSize < 1) pageSize = this.DEFAULT_PAGE_SIZE;
      if (pageSize > 200) pageSize = 200;

      var filterToken = this.readField(body, 'filter_token');
      var filtersActive = this.hasActiveFilters(criteria);
      var families = [];
      var totalFamilies = 0;
      var instanceIds = [];
      var truncated = false;
      var access = 'ok';
      var resultToken = null;

      if (filtersActive) {
        var cache = filterToken ? this.loadFilterCache(filterToken) : null;

        if (cache && cache.families) {
          families = cache.families;
          instanceIds = cache.instance_ids || [];
          totalFamilies = families.length;
          resultToken = filterToken;
        } else {
          var resolved = twoLevel
            ? this.resolveFilteredTwoLevel(criteria)
            : this.resolveFilteredThreeLevel(criteria);

          families = resolved.families || [];
          instanceIds = resolved.instance_ids || [];
          totalFamilies = families.length;
          truncated = resolved.truncated || false;
          resultToken = this.makeFilterToken();
          this.storeFilterCache(resultToken, families, instanceIds);
        }
      } else {
        var unfiltered = this.fetchUnfilteredFamilies(twoLevel, page, pageSize);
        families = unfiltered.families;
        totalFamilies = unfiltered.totalFamilies;
        instanceIds = [];
        resultToken = null;
      }

      var pageFamilies = filtersActive
        ? this.sliceFamilies(families, page, pageSize)
        : families;

      var restrictSet = filtersActive ? this.restrictSetFromArray(instanceIds) : null;
      var mapping = twoLevel
        ? this.buildTwoLevelMapping(pageFamilies, restrictSet)
        : this.buildThreeLevelMapping(pageFamilies, restrictSet);

      if (!mapping && pageFamilies.length > 0) access = 'error';

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
    } catch (e) {
      this.jsonError(response, 500, this.scriptError(e));
    }
  },

  type: 'ApplicationHomeHandler',
};
