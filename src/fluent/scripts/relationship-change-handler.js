var RelationshipChangeHandler = Class.create(); // NOSONAR: ServiceNow Script Include class must use var (Class.create convention)
RelationshipChangeHandler.prototype = {
  initialize: function () {},

  CHANGE_TABLE: 'x_citi4_clsa_cmd_0_relationship_change',
  REL_TYPES_PROP: 'x_citi4_clsa_cmd_0.app.to.app.relationship.types',
  DEFAULT_VALID_TYPES: ['impacts::impacted by', 'Receives data from::Sends data to'],
  VALID_DIRECTIONS: ['upstream', 'downstream', 'bidirectional'],
  VALID_ACTIONS: ['create', 'delete'],

  jsonError: function (response, status, message) {
    response.setStatus(status);
    response.setContentType('application/json');
    response.setBody({ error: message });
  },

  jsonOk: function (response, body) {
    response.setContentType('application/json');
    response.setBody(body);
  },

  sn: function (v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v !== null && 'value' in v) return String(v.value || '');
    return String(v);
  },

  _readFieldFromKeySet: function (obj, name) {
    try {
      if (typeof obj.keySet !== 'function') return '';
      const keys = obj.keySet().iterator();
      while (keys.hasNext()) {
        const k = String(keys.next());
        if (k === name) {
          const v = obj.get(k);
          if (v !== undefined && v !== null && String(v) !== '') return this.sn(v);
        }
      }
    } catch (error) { gs.debug('relationship-change readField keySet probe failed: ' + error); }
    return '';
  },

  readField: function (obj, name) {
    if (!obj) return '';
    const v0 = obj[name];
    if (v0 !== undefined && v0 !== null && String(v0) !== '') return this.sn(v0);
    try {
      if (typeof obj.get === 'function') {
        const vGet = obj.get(name);
        if (vGet !== undefined && vGet !== null && String(vGet) !== '') return this.sn(vGet);
      }
    } catch (error) { gs.debug('relationship-change readField obj.get probe failed: ' + error); }
    return this._readFieldFromKeySet(obj, name);
  },

  normalizeBody: function (raw) {
    if (!raw || typeof raw !== 'object') return {};
    const fields = [
      'action',
      'source_ci',
      'source_ci_sys_id',
      'target_ci',
      'target_ci_sys_id',
      'direction',
        'rel_type',
        'relationship_sys_id',
        'relationship_sys_ids',
      ];
    const out = {};
    for (const field of fields) {
      const val = this.readField(raw, field);
      if (val) out[field] = val;
    }
    return out;
  },

  _parseBodyFromData: function (wrapper) {
    if (!wrapper.data) return null;
    const data = wrapper.data;
    if (typeof data === 'string') return this.normalizeBody(JSON.parse(data));
    const fromData = this.normalizeBody(data);
    if (fromData.action || fromData.source_ci || fromData.relationship_sys_id || fromData.relationship_sys_ids) {
      return fromData;
    }
    return null;
  },

  _parseBodyFromDataString: function (wrapper) {
    if (!wrapper.dataString) return null;
    const ds = String(wrapper.dataString);
    if (!ds.length) return null;
    try {
      return this.normalizeBody(JSON.parse(ds));
    } catch (error) {
      gs.debug('relationship-change parseBody JSON.parse failed, using GlideJSON: ' + error);
      const parser = new global.JSON();
      return this.normalizeBody(parser.decode(ds));
    }
  },

  _parseBodyFromEntry: function (wrapper) {
    if (typeof wrapper.hasNext !== 'function' || !wrapper.hasNext()) return null;
    const entry = wrapper.nextEntry();
    if (typeof entry === 'string') return this.normalizeBody(JSON.parse(entry));
    return this.normalizeBody(entry);
  },

  parseBody: function (request) {
    try {
      const wrapper = request.body;
      if (!wrapper) return {};
      return this._parseBodyFromData(wrapper)
        ?? this._parseBodyFromDataString(wrapper)
        ?? this._parseBodyFromEntry(wrapper)
        ?? {};
    } catch (error) {
      gs.debug('relationship-change parseBody failed: ' + error);
      return null;
    }
  },

  scriptError: function (e) {
    if (!e) return 'Unknown server error';
    if (typeof e === 'string') return e;
    if (e.message) return String(e.message);
    return String(e);
  },

  getRelTypeSysId: function (relTypeName) {
    const gr = new GlideRecord('cmdb_rel_type');
    gr.addQuery('name', relTypeName);
    gr.setLimit(1);
    gr.query();
    if (gr.next()) return gr.getUniqueValue();

    gr.initialize();
    gr.addQuery('name', 'CONTAINS', relTypeName.split('::')[0]);
    gr.setLimit(5);
    gr.query();
    while (gr.next()) {
      if (String(gr.getValue('name')) === relTypeName) return gr.getUniqueValue();
    }
    return '';
  },

  getValidRelTypeNames: function () {
    const raw = String(gs.getProperty(this.REL_TYPES_PROP, '') || '').trim();
    const sysIds = raw
      ? raw.split(',').map(function (s) {
          return s.trim();
        }).filter(function (s) {
          return !!s;
        })
      : [];

    if (sysIds.length) {
      const names = [];
      const seen = {};
      const typeGr = new GlideRecord('cmdb_rel_type');
      typeGr.addQuery('sys_id', 'IN', sysIds.join(','));
      typeGr.query();
      const byId = {};
      while (typeGr.next()) {
        byId[String(typeGr.getUniqueValue())] = String(typeGr.getValue('name') || '');
      }
      for (const sysId of sysIds) {
        const name = byId[sysId];
        if (!name || seen[name]) continue;
        seen[name] = true;
        names.push(name);
      }
      if (names.length) return names;
    }

    return this.DEFAULT_VALID_TYPES.slice();
  },

  isValidRelType: function (relType) {
    return this.getValidRelTypeNames().includes(relType);
  },

  getCiDisplay: function (sysId) {
    if (!sysId) return '';
    const gr = new GlideRecord('cmdb_ci');
    if (!gr.get(sysId)) return sysId;
    return String(gr.getDisplayValue() || gr.getValue('name') || sysId);
  },

  getUserDisplay: function (sysId) {
    if (!sysId) return '';
    const gr = new GlideRecord('sys_user');
    if (!gr.get(sysId)) return sysId;
    return String(gr.getDisplayValue() || sysId);
  },

  resolveParentChild: function (sourceCi, targetCi, direction) {
    if (direction === 'downstream') {
      return { parent: sourceCi, child: targetCi };
    }
    if (direction === 'upstream') {
      return { parent: targetCi, child: sourceCi };
    }
    return { parent: sourceCi, child: targetCi };
  },

  resolveTargetCi: function (sourceCi, parentCi, childCi) {
    if (parentCi === sourceCi) return childCi;
    if (childCi === sourceCi) return parentCi;
    return childCi;
  },

  resolveDirectionFromRel: function (sourceCi, parentCi, childCi) {
    if (parentCi === sourceCi) return 'downstream';
    if (childCi === sourceCi) return 'upstream';
    return 'downstream';
  },

  resolveApprover: function (targetCiSysId) {
    const gr = new GlideRecord('cmdb_ci');
    if (!gr.get(targetCiSysId)) return '';
    const ownedBy = gr.getValue('owned_by');
    if (ownedBy) return ownedBy;
    return gr.getValue('managed_by') || '';
  },

  parseRelationshipSysIds: function (body) {
    const listField = this.readField(body, 'relationship_sys_ids');
    if (listField) {
      return listField.split(',').map(function (s) {
        return s.trim();
      }).filter(function (s) {
        return !!s;
      });
    }
    const single = this.readField(body, 'relationship_sys_id');
    return single ? [single] : [];
  },

  relationshipListValue: function (sysIds) {
    return sysIds.join(',');
  },

  hasPendingDeleteForRel: function (relationshipSysId) {
    const dup = new GlideRecord(this.CHANGE_TABLE);
    dup.addQuery('relationship', 'CONTAINS', relationshipSysId);
    dup.addQuery('state', 'pending_approval');
    dup.addQuery('action', 'delete');
    dup.setLimit(1);
    dup.query();
    return dup.hasNext();
  },

  hasPendingDelete: function (relationshipSysId) {
    return this.hasPendingDeleteForRel(relationshipSysId);
  },

  hasActiveRel: function (parentCi, childCi, relTypeName) {
    const typeId = this.getRelTypeSysId(relTypeName);
    if (!typeId) return false;
    const gr = new GlideRecord('cmdb_rel_ci');
    gr.addQuery('parent', parentCi);
    gr.addQuery('child', childCi);
    gr.addQuery('type', typeId);
    gr.setLimit(1);
    gr.query();
    return gr.hasNext();
  },

  serializeChangeRow: function (gr) {
    const approver = this.sn(gr.getValue('approver'));
    const requester = this.sn(gr.getValue('requested_by'));
    const state = this.sn(gr.getValue('state'));
    const action = this.sn(gr.getValue('action'));
    const relationshipRaw = this.sn(gr.getValue('relationship'));
    const relationshipSysIds = relationshipRaw
      ? relationshipRaw.split(',').map(function (s) {
          return s.trim();
        }).filter(function (s) {
          return !!s;
        })
      : [];
    return {
      sys_id: gr.getUniqueValue(),
      action: action,
      state: state,
      relationship_sys_id: relationshipRaw,
      relationship_sys_ids: relationshipSysIds,
      rel_type: this.sn(gr.getValue('rel_type')),
      parent_ci_sys_id: this.sn(gr.getValue('parent_ci')),
      child_ci_sys_id: this.sn(gr.getValue('child_ci')),
      source_ci_sys_id: this.sn(gr.getValue('source_ci')),
      target_ci_sys_id: this.sn(gr.getValue('target_ci')),
      source_ci_name: this.getCiDisplay(this.sn(gr.getValue('source_ci'))),
      target_ci_name: this.getCiDisplay(this.sn(gr.getValue('target_ci'))),
      direction: this.sn(gr.getValue('direction')),
      requested_by_sys_id: requester,
      requested_by_name: this.getUserDisplay(requester),
      requested_at: this.sn(gr.getValue('requested_at')),
      approver_sys_id: approver,
      approver_name: this.getUserDisplay(approver),
      approval_comments: this.sn(gr.getValue('approval_comments')),
      completed_at: this.sn(gr.getValue('completed_at')),
    };
  },

  countChangesForCi: function (ciSysId, stateFilter) {
    const ga = new GlideAggregate(this.CHANGE_TABLE);
    const qc = ga.addQuery('source_ci', ciSysId);
    qc.addOrCondition('target_ci', ciSysId);
    if (stateFilter) {
      ga.addQuery('state', stateFilter);
    }
    ga.addAggregate('COUNT');
    ga.query();
    if (ga.next()) {
      return Number.parseInt(ga.getAggregate('COUNT'), 10) || 0;
    }
    return 0;
  },

  handleGet: function (request, response) {
    const ciSysId = request.queryParams.ci_sys_id ? request.queryParams.ci_sys_id.toString() : '';

    if (!ciSysId) {
      this.jsonError(response, 400, 'Missing query parameter: ci_sys_id');
      return;
    }

    const limitParam = request.queryParams.limit ? request.queryParams.limit.toString() : '';
    const offsetParam = request.queryParams.offset ? request.queryParams.offset.toString() : '';
    const usePagination = limitParam !== '';

    let limit = usePagination ? Number.parseInt(limitParam, 10) : 200;
    let offset = usePagination ? (Number.parseInt(offsetParam, 10) || 0) : 0;
    if (Number.isNaN(limit) || limit < 1) limit = 10;
    if (limit > 200) limit = 200;
    if (Number.isNaN(offset) || offset < 0) offset = 0;

    const gr = new GlideRecord(this.CHANGE_TABLE);
    const qc = gr.addQuery('source_ci', ciSysId);
    qc.addOrCondition('target_ci', ciSysId);

    gr.orderByDesc('requested_at');
    if (usePagination) {
      gr.chooseWindow(offset, offset + limit - 1);
    } else {
      gr.setLimit(200);
    }
    gr.query();

    const rows = [];
    while (gr.next()) {
      rows.push(this.serializeChangeRow(gr));
    }

    const body = { result: rows };
    if (usePagination) {
      body.total_count = this.countChangesForCi(ciSysId);
      body.pending_count = this.countChangesForCi(ciSysId, 'pending_approval');
    }

    this.jsonOk(response, body);
  },

  _handleCreate: function (body, sourceCi, currentUserId, response) {
    const targetCi = this.readField(body, 'target_ci') || this.readField(body, 'target_ci_sys_id');
    const direction = this.readField(body, 'direction');
    const relType = this.readField(body, 'rel_type');

    if (!sourceCi || !targetCi || !direction || !relType) {
      this.jsonError(response, 400, 'Missing required fields for create: source_ci, target_ci, direction, rel_type');
      return;
    }
    if (!this.isValidRelType(relType)) {
      this.jsonError(response, 400, 'Invalid rel_type');
      return;
    }
    if (!this.VALID_DIRECTIONS.includes(direction)) {
      this.jsonError(response, 400, 'Invalid direction');
      return;
    }
    if (sourceCi === targetCi) {
      this.jsonError(response, 400, 'Source and target CI must differ');
      return;
    }

    const mapped = this.resolveParentChild(sourceCi, targetCi, direction);
    if (this.hasActiveRel(mapped.parent, mapped.child, relType)) {
      this.jsonError(response, 409, 'An active relationship already exists for this parent, child, and type.');
      return;
    }

    const typeId = this.getRelTypeSysId(relType);
    if (!typeId) {
      this.jsonError(response, 400, 'Relationship type not found in cmdb_rel_type: ' + relType);
      return;
    }

    const relGr = new GlideRecord('cmdb_rel_ci');
    relGr.initialize();
    relGr.setValue('parent', mapped.parent);
    relGr.setValue('child', mapped.child);
    relGr.setValue('type', typeId);
    const relSysId = relGr.insert();
    if (!relSysId) {
      this.jsonError(response, 500, 'Failed to create cmdb_rel_ci relationship. Your user may lack permission to create CI relationships.');
      return;
    }

    const changeGr = new GlideRecord(this.CHANGE_TABLE);
    changeGr.initialize();
    changeGr.setValue('action', 'create');
    changeGr.setValue('state', 'completed');
    changeGr.setValue('relationship', relSysId);
    changeGr.setValue('rel_type', relType);
    changeGr.setValue('parent_ci', mapped.parent);
    changeGr.setValue('child_ci', mapped.child);
    changeGr.setValue('source_ci', sourceCi);
    changeGr.setValue('target_ci', targetCi);
    changeGr.setValue('direction', direction);
    changeGr.setValue('requested_by', currentUserId);
    changeGr.setValue('requested_at', new GlideDateTime());
    changeGr.setValue('completed_at', new GlideDateTime());
    const changeSysId = changeGr.insert();
    if (!changeSysId) {
      this.jsonError(response, 500, 'Relationship created in CMDB but audit record insert failed. Check ACLs on Relationship Change table.');
      return;
    }

    changeGr.get(changeSysId);
    this.jsonOk(response, { result: this.serializeChangeRow(changeGr) });
  },

  _handleDeleteBidirectional: function (body, sourceCi, currentUserId, relationshipSysIds, response) {
    if (relationshipSysIds.length !== 2) {
      this.jsonError(response, 400, 'Bidirectional delete requires exactly two relationship sys_ids.');
      return;
    }

    const relRecords = [];
    for (const relSysId of relationshipSysIds) {
      const relGr = new GlideRecord('cmdb_rel_ci');
      if (!relGr.get(relSysId)) {
        this.jsonError(response, 404, 'Relationship not found: ' + relSysId);
        return;
      }
      relRecords.push({
        sysId: relSysId,
        parent: this.sn(relGr.getValue('parent')),
        child: this.sn(relGr.getValue('child')),
        type: this.sn(relGr.getValue('type')),
      });
    }

    if (!this._validateBiRelRecords(relRecords, sourceCi, relationshipSysIds, response)) return;

    const peerA = relRecords[0].parent === sourceCi ? relRecords[0].child : relRecords[0].parent;
    let relTypeBi = '';
    const typeGrBi = new GlideRecord('cmdb_rel_type');
    if (typeGrBi.get(relRecords[0].type)) relTypeBi = this.sn(typeGrBi.getValue('name'));

    const biChange = new GlideRecord(this.CHANGE_TABLE);
    biChange.initialize();
    biChange.setValue('action', 'delete');
    biChange.setValue('state', 'pending_approval');
    biChange.setValue('relationship', this.relationshipListValue(relationshipSysIds));
    biChange.setValue('rel_type', relTypeBi);
    biChange.setValue('parent_ci', relRecords[0].parent);
    biChange.setValue('child_ci', relRecords[0].child);
    biChange.setValue('source_ci', sourceCi);
    biChange.setValue('target_ci', peerA);
    biChange.setValue('direction', 'bidirectional');
    biChange.setValue('requested_by', currentUserId);
    biChange.setValue('requested_at', new GlideDateTime());
    const biSysId = biChange.insert();
    if (!biSysId) { this.jsonError(response, 500, 'Failed to create delete request'); return; }

    biChange.get(biSysId);
    this.jsonOk(response, { result: this.serializeChangeRow(biChange) });
  },

  _validateBiRelRecords: function (relRecords, sourceCi, relationshipSysIds, response) {
    const peerA = relRecords[0].parent === sourceCi ? relRecords[0].child : relRecords[0].parent;
    const peerB = relRecords[1].parent === sourceCi ? relRecords[1].child : relRecords[1].parent;
    if (peerA !== peerB) {
      this.jsonError(response, 400, 'Bidirectional relationships must share the same peer CI.');
      return false;
    }
    if (relRecords[0].parent !== sourceCi && relRecords[0].child !== sourceCi) {
      this.jsonError(response, 400, 'Source CI is not part of this relationship');
      return false;
    }
    if (relRecords[1].parent !== sourceCi && relRecords[1].child !== sourceCi) {
      this.jsonError(response, 400, 'Source CI is not part of this relationship');
      return false;
    }
    for (const relSysId of relationshipSysIds) {
      if (this.hasPendingDeleteForRel(relSysId)) {
        this.jsonError(response, 409, 'A pending delete request already exists for this relationship.');
        return false;
      }
    }
    return true;
  },

  _handleDelete: function (body, sourceCi, currentUserId, response) {
    const relationshipSysIds = this.parseRelationshipSysIds(body);
    const directionDel = this.readField(body, 'direction');
    if (!sourceCi || !relationshipSysIds.length) {
      this.jsonError(response, 400, 'Missing required fields for delete: source_ci, relationship_sys_ids');
      return;
    }

    if (directionDel === 'bidirectional' || relationshipSysIds.length > 1) {
      this._handleDeleteBidirectional(body, sourceCi, currentUserId, relationshipSysIds, response);
      return;
    }

    const relationshipSysId = relationshipSysIds[0];
    const existingRel = new GlideRecord('cmdb_rel_ci');
    if (!existingRel.get(relationshipSysId)) {
      this.jsonError(response, 404, 'Relationship not found');
      return;
    }

    const parentCi = this.sn(existingRel.getValue('parent'));
    const childCi = this.sn(existingRel.getValue('child'));
    if (parentCi !== sourceCi && childCi !== sourceCi) {
      this.jsonError(response, 400, 'Source CI is not part of this relationship');
      return;
    }
    if (this.hasPendingDeleteForRel(relationshipSysId)) {
      this.jsonError(response, 409, 'A pending delete request already exists for this relationship.');
      return;
    }

    const targetCiDel = this.resolveTargetCi(sourceCi, parentCi, childCi);
    const approver = this.resolveApprover(targetCiDel);
    if (!approver) {
      this.jsonError(response, 400, 'Cannot determine approver: target CI has no owned_by or managed_by.');
      return;
    }

    let relTypeDel = '';
    const typeGr = new GlideRecord('cmdb_rel_type');
    if (typeGr.get(existingRel.getValue('type'))) relTypeDel = this.sn(typeGr.getValue('name'));

    const resolvedDirection = this.resolveDirectionFromRel(sourceCi, parentCi, childCi);

    const delChange = new GlideRecord(this.CHANGE_TABLE);
    delChange.initialize();
    delChange.setValue('action', 'delete');
    delChange.setValue('state', 'pending_approval');
    delChange.setValue('relationship', relationshipSysId);
    delChange.setValue('rel_type', relTypeDel);
    delChange.setValue('parent_ci', parentCi);
    delChange.setValue('child_ci', childCi);
    delChange.setValue('source_ci', sourceCi);
    delChange.setValue('target_ci', targetCiDel);
    delChange.setValue('direction', resolvedDirection);
    delChange.setValue('requested_by', currentUserId);
    delChange.setValue('requested_at', new GlideDateTime());
    delChange.setValue('approver', approver);
    const delSysId = delChange.insert();
    if (!delSysId) { this.jsonError(response, 500, 'Failed to create delete request'); return; }

    delChange.get(delSysId);
    this.jsonOk(response, { result: this.serializeChangeRow(delChange) });
  },

  handlePost: function (request, response) {
    try {
      const body = this.parseBody(request);
      if (!body) {
        this.jsonError(response, 400, 'Invalid JSON body. Send Content-Type: application/json with action, source_ci, and other fields.');
        return;
      }

      const action = this.readField(body, 'action');
      const sourceCi = this.readField(body, 'source_ci') || this.readField(body, 'source_ci_sys_id');
      const currentUserId = gs.getUserID();

      if (!this.VALID_ACTIONS.includes(action)) {
        this.jsonError(response, 400, 'Invalid action. Use create or delete.');
        return;
      }

      if (action === 'create') { this._handleCreate(body, sourceCi, currentUserId, response); return; }
      if (action === 'delete') { this._handleDelete(body, sourceCi, currentUserId, response); return; }
    } catch (error) {
      this.jsonError(response, 500, this.scriptError(error));
    }
  },

  type: 'RelationshipChangeHandler',
};
