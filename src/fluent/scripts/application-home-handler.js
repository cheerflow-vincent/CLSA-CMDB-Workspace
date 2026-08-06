var ApplicationHomeHandler = Class.create();
ApplicationHomeHandler.prototype = {
  initialize: function () {},

  REL_CI_IN_CHUNK: 50,
  EDGE_BATCH: 100,
  MAX_EDGES: 50000,
  CACHE_PREFIX: 'clsa_app_home_filter_',
  UNFILTERED_CACHE_PREFIX: 'clsa_app_home_unfiltered_',
  CACHE_TTL_MS: 15 * 60 * 1000,
  DEFAULT_PAGE_SIZE: 50,
  LOG_SOURCE: 'CLSA.AppHome',

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
    // u_service_type / u_tier exist only on specific CI tables — use ref_* dot-walk.
    var childRef = twoLevel ? 'child.ref_cmdb_ci_service.' : 'child.ref_cmdb_ci_service_auto.';
    if (twoLevel) parts.push(childRef + 'u_service_type=instance');

    var q = (criteria.search || '').trim();
    if (q) parts.push(child + 'nameLIKE' + q);
    if (criteria.env.length) parts.push(child + 'environmentIN' + criteria.env.join(','));
    if (criteria.status.length) parts.push(child + 'operational_statusIN' + criteria.status.join(','));
    if (criteria.dept.length) parts.push(child + 'departmentIN' + criteria.dept.join(','));
    if (criteria.biz_unit.length) parts.push(child + 'business_unitIN' + criteria.biz_unit.join(','));
    if (criteria.tier.length) parts.push(childRef + 'u_tierIN' + criteria.tier.join(','));

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
    if (!ids.length) return 'ok';
    var chunkSize = this.REL_CI_IN_CHUNK;
    var self = this;
    var chunkNum = 0;
    for (var i = 0; i < ids.length; i += chunkSize) {
      chunkNum += 1;
      var slice = ids.slice(i, i + chunkSize);
      var encoded = inField + 'IN' + slice.join(',');
      if (extraQuery) encoded += '^' + extraQuery;
      var gr = new GlideRecord('cmdb_rel_ci');
      gr.addEncodedQuery(encoded);
      gr.setLimit(5000);
      gr.query();
      var count = 0;
      while (gr.next()) {
        count += 1;
        rowHandler(self.relCiRow(gr));
      }
      self.logQuery(
        logLabel || 'rel_ci_chunk',
        'table=cmdb_rel_ci chunk=' + chunkNum + '/' + Math.ceil(ids.length / chunkSize)
          + ' id_count=' + slice.length
          + ' rows=' + count
          + ' sysparm_query=' + encoded
      );
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

  unfilteredCacheKey: function (twoLevel) {
    return this.UNFILTERED_CACHE_PREFIX + (twoLevel ? '2l' : '3l');
  },

  storeUnfilteredCache: function (twoLevel, families) {
    gs.getSession().putClientData(this.unfilteredCacheKey(twoLevel), JSON.stringify({
      families: families,
      created_at: new Date().getTime(),
    }));
  },

  loadUnfilteredCache: function (twoLevel) {
    var raw = gs.getSession().getClientData(this.unfilteredCacheKey(twoLevel));
    if (!raw) return null;
    try {
      var data = JSON.parse(raw);
      if (!data || !data.created_at || !Array.isArray(data.families)) return null;
      if (new Date().getTime() - data.created_at > this.CACHE_TTL_MS) return null;
      return data.families;
    } catch (e) {
      return null;
    }
  },

  /** Scan all family rows; return only those with at least one instance (session-cached). */
  resolveUnfilteredVisibleFamilies: function (twoLevel) {
    var cached = this.loadUnfilteredCache(twoLevel);
    if (cached) {
      this.logQuery('unfiltered_cache_hit', 'families=' + cached.length);
      return cached;
    }

    var table = twoLevel ? 'cmdb_ci_service' : 'cmdb_ci_business_app';
    var scanBatch = 50;
    var offset = 0;
    var visible = [];
    var tableRowsScanned = 0;

    this.logQuery(
      'unfiltered_visible_scan_start',
      'table=' + table + ' batch=' + scanBatch
    );

    while (true) {
      var gr = new GlideRecord(table);
      if (twoLevel) gr.addQuery('u_service_type', 'service');
      gr.orderBy('name');
      gr.chooseWindow(offset, offset + scanBatch);
      gr.query();

      var batch = [];
      while (gr.next()) {
        batch.push({
          sys_id: gr.getUniqueValue(),
          name: gr.getValue('name') || gr.getDisplayValue('name') || gr.getUniqueValue(),
          short_description: gr.getValue('short_description') || '',
        });
      }
      if (!batch.length) break;

      tableRowsScanned += batch.length;
      var mapping = twoLevel
        ? this.buildTwoLevelMapping(batch, null)
        : this.buildThreeLevelMapping(batch, null);

      if (mapping) {
        if (twoLevel) {
          for (var appId in mapping.app_family_meta) {
            if (!mapping.app_family_meta.hasOwnProperty(appId)) continue;
            var meta = mapping.app_family_meta[appId];
            visible.push({
              sys_id: appId,
              name: meta.name,
              short_description: meta.short_description || '',
            });
          }
        } else {
          for (var i = 0; i < mapping.b_apps.length; i++) {
            visible.push(mapping.b_apps[i]);
          }
        }
      }

      offset += batch.length;
      if (batch.length < scanBatch) break;
    }

    visible = this.sortFamilies(visible);
    this.storeUnfilteredCache(twoLevel, visible);
    this.logQuery(
      'unfiltered_visible_scan_result',
      'table_rows_scanned=' + tableRowsScanned + ' visible_families=' + visible.length
    );
    return visible;
  },

  sortFamilies: function (families) {
    families.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return families;
  },

  queryFilteredInstanceEdges: function (criteria, twoLevel, limit, offset) {
    var rows = [];
    var encoded = this.buildRelCiInstanceEdgeQuery(criteria, twoLevel);
    var gr = new GlideRecord('cmdb_rel_ci');
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
    this.logQuery(
      'resolve_2level_summary',
      'total_edges=' + totalEdges + ' instance_ids=' + instanceIds.length
        + ' intermediate_ids=' + intermediateIds.length + ' truncated=' + truncated
    );
    if (!intermediateIds.length) {
      return { access: 'ok', families: [], instance_ids: instanceIds, truncated: truncated };
    }

    // u_service_type exists only on cmdb_ci_service — parent is the app-family service CI.
    var hopExtraQuery =
      'type.name=Connects to::Connected by^parent.ref_cmdb_ci_service.u_service_type=service';
    this.logQuery(
      'resolve_2level_hop_query',
      'intermediate_count=' + intermediateIds.length
        + ' intermediate_ids=' + intermediateIds.join(',')
        + ' sysparm_query=child.sys_idIN' + intermediateIds.join(',')
        + '^' + hopExtraQuery
    );

    var familyMap = {};
    this.queryRelCiInChunks(
      'child.sys_id',
      intermediateIds,
      hopExtraQuery,
      function (row) {
        if (!row.parent || familyMap[row.parent]) return;
        familyMap[row.parent] = {
          sys_id: row.parent,
          name: row.parentName || row.parent,
          short_description: row.parentShortDescription || '',
        };
      },
      'resolve_2level_hop'
    );

    var families = [];
    for (var fid in familyMap) {
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
    this.logQuery(
      'resolve_3level_summary',
      'total_edges=' + totalEdges + ' instance_ids=' + instanceIds.length
        + ' service_ids=' + serviceIds.length + ' truncated=' + truncated
    );
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
      },
      'resolve_3level_hop'
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
    var encoded = twoLevel ? 'u_service_type=service' : '';
    this.logQuery(
      'unfiltered_families_query',
      'table=' + table + ' page=' + page + ' page_size=' + pageSize
        + ' sysparm_query=' + encoded + '^ORDERBYname'
    );
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

    this.logQuery(
      'unfiltered_families_result',
      'table=' + table + ' page_rows=' + families.length + ' total_families=' + totalFamilies
    );

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
      },
      'mapping_2level_hop1'
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
        'type.name=Connects to::Connected by^child.ref_cmdb_ci_service.u_service_type=instance',
        function (row) {
          if (!row.parent || !row.child) return;
          if (!hop2Map[row.parent]) hop2Map[row.parent] = [];
          hop2Map[row.parent].push(row.child);
        },
        'mapping_2level_hop2'
      );
    }

    var appToInstances = {};
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
          }
        }
      }
      appToInstances[appId] = instList;
    }

    var prunedMeta = {};
    var prunedMap = {};
    var prunedInstMap = {};
    for (var fi2 = 0; fi2 < familyIds.length; fi2++) {
      var fid = familyIds[fi2];
      var insts = appToInstances[fid] || [];
      if (!insts.length) continue;
      prunedMeta[fid] = appFamilyMeta[fid];
      prunedMap[fid] = insts;
      for (var xi = 0; xi < insts.length; xi++) prunedInstMap[insts[xi]] = true;
    }
    if (!Object.keys(prunedMap).length) return null;

    return {
      app_family_meta: prunedMeta,
      app_to_instances: prunedMap,
      instance_svc_ids: Object.keys(prunedInstMap),
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
      },
      'mapping_3level_consumes'
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
        },
        'mapping_3level_contains'
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

    var prunedSvcToInstIds = {};
    for (var svcId in svcToInstIds) {
      if (!svcToInstIds.hasOwnProperty(svcId)) continue;
      if (svcToInstIds[svcId].length) prunedSvcToInstIds[svcId] = svcToInstIds[svcId];
    }

    var prunedBAppToSvcs = {};
    var visibleBApps = [];
    for (var bi = 0; bi < bApps.length; bi++) {
      var app = bApps[bi];
      var svcList = bAppToSvcs[app.sys_id] || [];
      var visibleSvcs = [];
      for (var si = 0; si < svcList.length; si++) {
        if (prunedSvcToInstIds[svcList[si]]) visibleSvcs.push(svcList[si]);
      }
      if (!visibleSvcs.length) continue;
      visibleBApps.push(app);
      prunedBAppToSvcs[app.sys_id] = visibleSvcs;
    }
    if (!visibleBApps.length) return null;

    var prunedInstanceIdMap = {};
    for (var svcKey in prunedSvcToInstIds) {
      if (!prunedSvcToInstIds.hasOwnProperty(svcKey)) continue;
      var instArr = prunedSvcToInstIds[svcKey];
      for (var ik = 0; ik < instArr.length; ik++) prunedInstanceIdMap[instArr[ik]] = true;
    }

    return {
      b_apps: visibleBApps,
      svc_map: svcMap,
      b_app_to_svcs: prunedBAppToSvcs,
      svc_to_inst_ids: prunedSvcToInstIds,
      instance_ids: Object.keys(prunedInstanceIdMap),
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
      this.logQuery(
        'request',
        'hierarchy_mode=' + hierarchyMode
          + ' filters_active=' + filtersActive
          + ' page=' + page
          + ' page_size=' + pageSize
          + ' filter_token=' + (filterToken || '')
          + ' criteria=' + JSON.stringify(criteria)
      );
      var families = [];
      var totalFamilies = 0;
      var instanceIds = [];
      var truncated = false;
      var access = 'ok';
      var resultToken = null;

      if (filtersActive) {
        var cache = filterToken ? this.loadFilterCache(filterToken) : null;

        // Empty families + non-empty instance_ids is a stale/broken cache (e.g. hop dot-walk fix).
        var cacheUsable = cache
          && Array.isArray(cache.families)
          && (cache.families.length > 0
            || !(cache.instance_ids && cache.instance_ids.length));
        if (cacheUsable) {
          families = cache.families;
          instanceIds = cache.instance_ids || [];
          totalFamilies = families.length;
          resultToken = filterToken;
          this.logQuery(
            'filter_cache_hit',
            'families=' + families.length + ' instance_ids=' + instanceIds.length
          );
        } else {
          if (cache) {
            this.logQuery(
              'filter_cache_skip',
              'reason=instance_ids_without_families'
                + ' instance_ids=' + ((cache.instance_ids && cache.instance_ids.length) || 0)
            );
          }
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
        families = this.resolveUnfilteredVisibleFamilies(twoLevel);
        totalFamilies = families.length;
        instanceIds = [];
        resultToken = null;
      }

      var pageFamilies = this.sliceFamilies(families, page, pageSize);

      var restrictSet = filtersActive ? this.restrictSetFromArray(instanceIds) : null;
      var mapping = twoLevel
        ? this.buildTwoLevelMapping(pageFamilies, restrictSet)
        : this.buildThreeLevelMapping(pageFamilies, restrictSet);

      if (!mapping && pageFamilies.length > 0) access = 'error';

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
    } catch (e) {
      this.jsonError(response, 500, this.scriptError(e));
    }
  },

  type: 'ApplicationHomeHandler',
};
