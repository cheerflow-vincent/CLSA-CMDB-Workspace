var CiSearchDistinctCountHandler = Class.create();
CiSearchDistinctCountHandler.prototype = {
  initialize: function () {},

  LOG_SOURCE: 'CLSA.CiSearchDistinctCount',

  CI_IN_CHUNK: 150,
  MAX_CI_FLAG_IDS: 500,

  INCIDENT_EXTRA: 'task.sys_class_name=incident^task.active=true',
  CHANGE_EXTRA:
    'task.sys_class_name=change_request^task.active=true^task.ref_change_request.start_date>=javascript:gs.beginningOfToday()',

  ALLOWED_TABLES: {
    task_ci: { field: 'task' },
    cmdb_health_result: { field: 'sys_id' },
  },

  logQuery: function (label, message) {
    gs.info('[CLSA CiSearchDistinctCount] ' + label + ' | ' + message, this.LOG_SOURCE);
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

  readField: function (obj, name) {
    if (!obj) return '';
    var v = obj[name];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
    try {
      if (typeof obj.get === 'function') {
        v = obj.get(name);
        if (v !== undefined && v !== null && String(v) !== '') return String(v);
      }
    } catch (e1) {}
    return '';
  },

  isValidSysId: function (id) {
    return /^[0-9a-f]{32}$/.test(String(id || ''));
  },

  readSysIdArray: function (obj, name) {
    if (!obj || typeof obj !== 'object') return [];
    var v = obj[name];
    if (!v && typeof obj.get === 'function') {
      try { v = obj.get(name); } catch (e0) {}
    }
    if (!Array.isArray(v)) return [];

    var seen = {};
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var id = String(v[i] || '').trim();
      if (!this.isValidSysId(id) || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  },

  normalizeBody: function (raw) {
    if (!raw || typeof raw !== 'object') return {};
    return {
      incident_query: this.readField(raw, 'incident_query'),
      change_query: this.readField(raw, 'change_query'),
      health_query: this.readField(raw, 'health_query'),
    };
  },

  normalizeFlagCountsBody: function (raw) {
    if (!raw || typeof raw !== 'object') return { ci_sys_ids: [] };
    return { ci_sys_ids: this.readSysIdArray(raw, 'ci_sys_ids') };
  },

  parseBody: function (request) {
    try {
      var wrapper = request.body;
      if (!wrapper) return {};

      if (wrapper.data) {
        var data = wrapper.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (parseErr) {
            return {};
          }
        }
        return this.normalizeBody(data);
      }

      if (typeof wrapper === 'string') {
        try {
          return this.normalizeBody(JSON.parse(wrapper));
        } catch (parseErr2) {
          return {};
        }
      }

      return this.normalizeBody(wrapper);
    } catch (e) {
      return {};
    }
  },

  parseFlagCountsBody: function (request) {
    try {
      var wrapper = request.body;
      if (!wrapper) return { ci_sys_ids: [] };

      if (wrapper.data) {
        var data = wrapper.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (parseErr) {
            return { ci_sys_ids: [] };
          }
        }
        return this.normalizeFlagCountsBody(data);
      }

      if (typeof wrapper === 'string') {
        try {
          return this.normalizeFlagCountsBody(JSON.parse(wrapper));
        } catch (parseErr2) {
          return { ci_sys_ids: [] };
        }
      }

      return this.normalizeFlagCountsBody(wrapper);
    } catch (e) {
      return { ci_sys_ids: [] };
    }
  },

  isAllowedSpec: function (table, field) {
    var spec = this.ALLOWED_TABLES[table];
    return spec && spec.field === field;
  },

  countDistinct: function (table, field, encodedQuery) {
    if (!this.isAllowedSpec(table, field)) {
      return { totalCount: 0, access: 'denied' };
    }
    if (!encodedQuery) {
      return { totalCount: 0, access: 'ok' };
    }

    try {
      var ga = new GlideAggregate(table);
      ga.addEncodedQuery(encodedQuery);
      ga.addAggregate('COUNT(DISTINCT', field);
      ga.setGroup(false);
      ga.query();

      if (!ga.next()) {
        return { totalCount: 0, access: 'ok' };
      }

      var count = parseInt(ga.getAggregate('COUNT(DISTINCT', field), 10) || 0;
      return { totalCount: count, access: 'ok' };
    } catch (e) {
      this.logQuery('countDistinct_error', 'table=' + table + ' field=' + field + ' err=' + this.scriptError(e));
      return { totalCount: 0, access: 'error' };
    }
  },

  countDistinctTasksByCi: function (ciSysIds, extraQuery) {
    var counts = {};
    var i;
    for (i = 0; i < ciSysIds.length; i++) {
      counts[ciSysIds[i]] = 0;
    }

    if (!ciSysIds.length || !extraQuery) {
      return { counts: counts, access: 'ok' };
    }

    try {
      for (i = 0; i < ciSysIds.length; i += this.CI_IN_CHUNK) {
        var chunk = ciSysIds.slice(i, i + this.CI_IN_CHUNK);
        var idsQuery = chunk.join(',');
        var encodedQuery = 'ci_item.sys_idIN' + idsQuery + '^' + extraQuery;

        var ga = new GlideAggregate('task_ci');
        ga.addEncodedQuery(encodedQuery);
        ga.groupBy('ci_item');
        ga.addAggregate('COUNT(DISTINCT', 'task');
        ga.query();

        while (ga.next()) {
          var ciId = ga.getValue('ci_item');
          if (!ciId) continue;
          var count = parseInt(ga.getAggregate('COUNT(DISTINCT', 'task'), 10) || 0;
          counts[ciId] = count;
        }
      }

      return { counts: counts, access: 'ok' };
    } catch (e) {
      this.logQuery(
        'countDistinctTasksByCi_error',
        'ids=' + ciSysIds.length + ' err=' + this.scriptError(e)
      );
      return { counts: counts, access: 'error' };
    }
  },

  handlePost: function (request, response) {
    var body = this.parseBody(request);
    var incidentQuery = body.incident_query || '';
    var changeQuery = body.change_query || '';
    var healthQuery = body.health_query || '';

    this.logQuery(
      'request',
      'incident_len=' + incidentQuery.length
        + ' change_len=' + changeQuery.length
        + ' health_len=' + healthQuery.length
    );

    var incidentRes = this.countDistinct('task_ci', 'task', incidentQuery);
    var changeRes = this.countDistinct('task_ci', 'task', changeQuery);
    var healthRes = this.countDistinct('cmdb_health_result', 'sys_id', healthQuery);

    this.jsonOk(response, {
      incidents: incidentRes.totalCount,
      changes: changeRes.totalCount,
      health: healthRes.totalCount,
      access: {
        incidents: incidentRes.access,
        changes: changeRes.access,
        health: healthRes.access,
      },
    });
  },

  handleFlagCountsPost: function (request, response) {
    var body = this.parseFlagCountsBody(request);
    var ciSysIds = body.ci_sys_ids || [];

    if (ciSysIds.length > this.MAX_CI_FLAG_IDS) {
      this.jsonError(response, 400, 'Too many ci_sys_ids (max ' + this.MAX_CI_FLAG_IDS + ')');
      return;
    }

    this.logQuery('flag_counts_request', 'ci_count=' + ciSysIds.length);

    if (!ciSysIds.length) {
      this.jsonOk(response, {
        counts: {},
        access: { incidents: 'ok', changes: 'ok' },
      });
      return;
    }

    var incidentRes = this.countDistinctTasksByCi(ciSysIds, this.INCIDENT_EXTRA);
    var changeRes = this.countDistinctTasksByCi(ciSysIds, this.CHANGE_EXTRA);

    var counts = {};
    var idx;
    for (idx = 0; idx < ciSysIds.length; idx++) {
      var id = ciSysIds[idx];
      counts[id] = {
        incidents: incidentRes.counts[id] || 0,
        changes: changeRes.counts[id] || 0,
      };
    }

    this.jsonOk(response, {
      counts: counts,
      access: {
        incidents: incidentRes.access,
        changes: changeRes.access,
      },
    });
  },
};
