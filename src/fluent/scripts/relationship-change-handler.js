var RelationshipChangeHandler = Class.create();
RelationshipChangeHandler.prototype = {
  initialize: function () {},

  CHANGE_TABLE: 'x_citi4_clsa_cmd_0_relationship_change',
  IMP_TYPE: 'impacts::impacted by',
  RDF_TYPE: 'Receives data from::Sends data to',
  VALID_TYPES: ['impacts::impacted by', 'Receives data from::Sends data to'],
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
    try {
      if (typeof obj.keySet === 'function') {
        var keys = obj.keySet().iterator();
        while (keys.hasNext()) {
          var k = String(keys.next());
          if (k === name) {
            v = obj.get(k);
            if (v !== undefined && v !== null && String(v) !== '') return this.sn(v);
          }
        }
      }
    } catch (e2) {}
    return '';
  },

  normalizeBody: function (raw) {
    if (!raw || typeof raw !== 'object') return {};
    var fields = [
      'action',
      'source_ci',
      'source_ci_sys_id',
      'target_ci',
      'target_ci_sys_id',
      'direction',
      'rel_type',
        'relationship_sys_id',
      ];
    var out = {};
    for (var i = 0; i < fields.length; i++) {
      var val = this.readField(raw, fields[i]);
      if (val) out[fields[i]] = val;
    }
    return out;
  },

  parseBody: function (request) {
    try {
      var wrapper = request.body;
      if (!wrapper) return {};

      if (wrapper.data) {
        var data = wrapper.data;
        if (typeof data === 'string') {
          return this.normalizeBody(JSON.parse(data));
        }
        var fromData = this.normalizeBody(data);
        if (fromData.action || fromData.source_ci || fromData.relationship_sys_id) {
          return fromData;
        }
      }

      if (wrapper.dataString) {
        var ds = String(wrapper.dataString);
        if (ds.length > 0) {
          try {
            return this.normalizeBody(JSON.parse(ds));
          } catch (e1) {
            var parser = new global.JSON();
            return this.normalizeBody(parser.decode(ds));
          }
        }
      }

      if (typeof wrapper.hasNext === 'function' && wrapper.hasNext()) {
        var entry = wrapper.nextEntry();
        if (typeof entry === 'string') {
          return this.normalizeBody(JSON.parse(entry));
        }
        return this.normalizeBody(entry);
      }

      return {};
    } catch (e) {
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
    var gr = new GlideRecord('cmdb_rel_type');
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

  getCiDisplay: function (sysId) {
    if (!sysId) return '';
    var gr = new GlideRecord('cmdb_ci');
    if (!gr.get(sysId)) return sysId;
    return String(gr.getDisplayValue() || gr.getValue('name') || sysId);
  },

  getUserDisplay: function (sysId) {
    if (!sysId) return '';
    var gr = new GlideRecord('sys_user');
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
    var gr = new GlideRecord('cmdb_ci');
    if (!gr.get(targetCiSysId)) return '';
    var ownedBy = gr.getValue('owned_by');
    if (ownedBy) return ownedBy;
    return gr.getValue('managed_by') || '';
  },

  hasPendingDelete: function (relationshipSysId) {
    var dup = new GlideRecord(this.CHANGE_TABLE);
    dup.addQuery('relationship', relationshipSysId);
    dup.addQuery('state', 'pending_approval');
    dup.addQuery('action', 'delete');
    dup.setLimit(1);
    dup.query();
    return dup.hasNext();
  },

  hasActiveRel: function (parentCi, childCi, relTypeName) {
    var typeId = this.getRelTypeSysId(relTypeName);
    if (!typeId) return false;
    var gr = new GlideRecord('cmdb_rel_ci');
    gr.addQuery('parent', parentCi);
    gr.addQuery('child', childCi);
    gr.addQuery('type', typeId);
    gr.setLimit(1);
    gr.query();
    return gr.hasNext();
  },

  serializeChangeRow: function (gr) {
    var approver = this.sn(gr.getValue('approver'));
    var requester = this.sn(gr.getValue('requested_by'));
    var state = this.sn(gr.getValue('state'));
    var action = this.sn(gr.getValue('action'));
    return {
      sys_id: gr.getUniqueValue(),
      action: action,
      state: state,
      relationship_sys_id: this.sn(gr.getValue('relationship')),
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

  handleGet: function (request, response) {
    var ciSysId = request.queryParams.ci_sys_id ? request.queryParams.ci_sys_id.toString() : '';

    if (!ciSysId) {
      this.jsonError(response, 400, 'Missing query parameter: ci_sys_id');
      return;
    }

    var gr = new GlideRecord(this.CHANGE_TABLE);
    var qc = gr.addQuery('source_ci', ciSysId);
    qc.addOrCondition('target_ci', ciSysId);

    gr.orderByDesc('requested_at');
    gr.setLimit(200);
    gr.query();

    var rows = [];
    while (gr.next()) {
      rows.push(this.serializeChangeRow(gr));
    }

    this.jsonOk(response, {
      result: rows,
    });
  },

  handlePost: function (request, response) {
    try {
      var body = this.parseBody(request);
      if (!body) {
        this.jsonError(
          response,
          400,
          'Invalid JSON body. Send Content-Type: application/json with action, source_ci, and other fields.',
        );
        return;
      }

      var action = this.readField(body, 'action');
      var sourceCi = this.readField(body, 'source_ci') || this.readField(body, 'source_ci_sys_id');
      var currentUserId = gs.getUserID();

      if (this.VALID_ACTIONS.indexOf(action) === -1) {
        this.jsonError(response, 400, 'Invalid action. Use create or delete.');
        return;
      }

      if (action === 'create') {
        var targetCi = this.readField(body, 'target_ci') || this.readField(body, 'target_ci_sys_id');
        var direction = this.readField(body, 'direction');
        var relType = this.readField(body, 'rel_type');

        if (!sourceCi || !targetCi || !direction || !relType) {
          this.jsonError(
            response,
            400,
            'Missing required fields for create: source_ci, target_ci, direction, rel_type',
          );
          return;
        }
        if (this.VALID_TYPES.indexOf(relType) === -1) {
          this.jsonError(response, 400, 'Invalid rel_type');
          return;
        }
        if (this.VALID_DIRECTIONS.indexOf(direction) === -1) {
          this.jsonError(response, 400, 'Invalid direction');
          return;
        }
        if (sourceCi === targetCi) {
          this.jsonError(response, 400, 'Source and target CI must differ');
          return;
        }

        var mapped = this.resolveParentChild(sourceCi, targetCi, direction);
        if (this.hasActiveRel(mapped.parent, mapped.child, relType)) {
          this.jsonError(response, 409, 'An active relationship already exists for this parent, child, and type.');
          return;
        }

        var typeId = this.getRelTypeSysId(relType);
        if (!typeId) {
          this.jsonError(response, 400, 'Relationship type not found in cmdb_rel_type: ' + relType);
          return;
        }

        var relGr = new GlideRecord('cmdb_rel_ci');
        relGr.initialize();
        relGr.setValue('parent', mapped.parent);
        relGr.setValue('child', mapped.child);
        relGr.setValue('type', typeId);
        var relSysId = relGr.insert();
        if (!relSysId) {
          this.jsonError(
            response,
            500,
            'Failed to create cmdb_rel_ci relationship. Your user may lack permission to create CI relationships.',
          );
          return;
        }

        var changeGr = new GlideRecord(this.CHANGE_TABLE);
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
        var changeSysId = changeGr.insert();
        if (!changeSysId) {
          this.jsonError(
            response,
            500,
            'Relationship created in CMDB but audit record insert failed. Check ACLs on Relationship Change table.',
          );
          return;
        }

        changeGr.get(changeSysId);
        this.jsonOk(response, { result: this.serializeChangeRow(changeGr) });
        return;
      }

      if (action === 'delete') {
        var relationshipSysId = this.readField(body, 'relationship_sys_id');
        if (!sourceCi || !relationshipSysId) {
          this.jsonError(response, 400, 'Missing required fields for delete: source_ci, relationship_sys_id');
          return;
        }

        var existingRel = new GlideRecord('cmdb_rel_ci');
        if (!existingRel.get(relationshipSysId)) {
          this.jsonError(response, 404, 'Relationship not found');
          return;
        }

        var parentCi = this.sn(existingRel.getValue('parent'));
        var childCi = this.sn(existingRel.getValue('child'));
        if (parentCi !== sourceCi && childCi !== sourceCi) {
          this.jsonError(response, 400, 'Source CI is not part of this relationship');
          return;
        }

        if (this.hasPendingDelete(relationshipSysId)) {
          this.jsonError(response, 409, 'A pending delete request already exists for this relationship.');
          return;
        }

        var targetCiDel = this.resolveTargetCi(sourceCi, parentCi, childCi);
        var approver = this.resolveApprover(targetCiDel);
        if (!approver) {
          this.jsonError(response, 400, 'Cannot determine approver: target CI has no owned_by or managed_by.');
          return;
        }

        var relTypeDel = '';
        var typeGr = new GlideRecord('cmdb_rel_type');
        if (typeGr.get(existingRel.getValue('type'))) {
          relTypeDel = this.sn(typeGr.getValue('name'));
        }

        var directionDel = this.resolveDirectionFromRel(sourceCi, parentCi, childCi);

        var delChange = new GlideRecord(this.CHANGE_TABLE);
        delChange.initialize();
        delChange.setValue('action', 'delete');
        delChange.setValue('state', 'pending_approval');
        delChange.setValue('relationship', relationshipSysId);
        delChange.setValue('rel_type', relTypeDel);
        delChange.setValue('parent_ci', parentCi);
        delChange.setValue('child_ci', childCi);
        delChange.setValue('source_ci', sourceCi);
        delChange.setValue('target_ci', targetCiDel);
        delChange.setValue('direction', directionDel);
        delChange.setValue('requested_by', currentUserId);
        delChange.setValue('requested_at', new GlideDateTime());
        delChange.setValue('approver', approver);
        var delSysId = delChange.insert();
        if (!delSysId) {
          this.jsonError(response, 500, 'Failed to create delete request');
          return;
        }

        delChange.get(delSysId);
        this.jsonOk(response, { result: this.serializeChangeRow(delChange) });
      }
    } catch (e) {
      this.jsonError(response, 500, this.scriptError(e));
    }
  },

  type: 'RelationshipChangeHandler',
};
