var RelationshipApprovalHandler = Class.create();
RelationshipApprovalHandler.prototype = {
  initialize: function () {},

  APPROVAL_TABLE: 'sysapproval_approver',
  CHANGE_TABLE: 'x_citi4_clsa_cmd_0_relationship_change',
  VALID_DECISIONS: ['approve', 'reject'],

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
    return '';
  },

  parseBody: function (request) {
    try {
      var wrapper = request.body;
      if (!wrapper) return {};

      var raw = null;
      if (wrapper.data) {
        var data = wrapper.data;
        if (typeof data === 'string') raw = JSON.parse(data);
        else raw = data;
      } else if (wrapper.dataString) {
        var ds = String(wrapper.dataString);
        if (ds.length > 0) raw = JSON.parse(ds);
      }

      if (!raw || typeof raw !== 'object') return {};
      return {
        decision: this.readField(raw, 'decision'),
        comments: this.readField(raw, 'comments') || this.readField(raw, 'approval_comments'),
      };
    } catch (e) {
      return null;
    }
  },

  isAdminUser: function () {
    return gs.hasRole('admin') || gs.hasRole('x_citi4_clsa_cmd_0.admin');
  },

  isRelationshipChangeDocument: function (documentId) {
    if (!documentId) return false;
    var gr = new GlideRecord(this.CHANGE_TABLE);
    return gr.get(documentId);
  },

  serializeApprovalRow: function (gr) {
    return {
      sys_id: gr.getUniqueValue(),
      document_id: this.sn(gr.getValue('document_id')),
      state: this.sn(gr.getValue('state')),
      approver_sys_id: this.sn(gr.getValue('approver')),
      approver_name: gr.getDisplayValue('approver') || '',
      comments: this.sn(gr.getValue('comments')),
      due_date: this.sn(gr.getValue('due_date')),
      sysapproval_sys_id: this.sn(gr.getValue('sysapproval')),
    };
  },

  serializeChangeSummary: function (gr) {
    return {
      sys_id: gr.getUniqueValue(),
      action: this.sn(gr.getValue('action')),
      state: this.sn(gr.getValue('state')),
      relationship_sys_id: this.sn(gr.getValue('relationship')),
      rel_type: this.sn(gr.getValue('rel_type')),
      source_ci_sys_id: this.sn(gr.getValue('source_ci')),
      target_ci_sys_id: this.sn(gr.getValue('target_ci')),
      source_ci_name: gr.getDisplayValue('source_ci') || '',
      target_ci_name: gr.getDisplayValue('target_ci') || '',
      direction: this.sn(gr.getValue('direction')),
      requested_by_name: gr.getDisplayValue('requested_by') || '',
      requested_at: this.sn(gr.getValue('requested_at')),
    };
  },

  queryRequestedForUser: function (currentUserId, documentId) {
    var gr = new GlideRecord(this.APPROVAL_TABLE);
    gr.addQuery('approver', currentUserId);
    gr.addQuery('state', 'requested');
    if (documentId) gr.addQuery('document_id', documentId);
    gr.orderByDesc('sys_created_on');
    gr.setLimit(200);
    gr.query();
    return gr;
  },

  handleGet: function (request, response) {
    var currentUserId = gs.getUserID();
    var documentId = request.queryParams.document_id
      ? request.queryParams.document_id.toString()
      : '';
    var ciSysId = request.queryParams.ci_sys_id ? request.queryParams.ci_sys_id.toString() : '';
    var inbox = request.queryParams.inbox ? request.queryParams.inbox.toString() : '';

    if (!documentId && !ciSysId && inbox !== 'approver') {
      this.jsonError(
        response,
        400,
        'Missing query parameter: document_id, ci_sys_id, or inbox=approver',
      );
      return;
    }

    var rows = [];
    var gr = this.queryRequestedForUser(currentUserId, documentId);

    while (gr.next()) {
      var docId = this.sn(gr.getValue('document_id'));
      if (!this.isRelationshipChangeDocument(docId)) continue;

      if (ciSysId) {
        var changeGr = new GlideRecord(this.CHANGE_TABLE);
        if (!changeGr.get(docId)) continue;
        var sourceCi = this.sn(changeGr.getValue('source_ci'));
        var targetCi = this.sn(changeGr.getValue('target_ci'));
        if (sourceCi !== ciSysId && targetCi !== ciSysId) continue;
      }

      var row = this.serializeApprovalRow(gr);
      if (inbox === 'approver' || ciSysId) {
        var change = new GlideRecord(this.CHANGE_TABLE);
        if (change.get(docId)) {
          row.change = this.serializeChangeSummary(change);
        }
      }
      rows.push(row);
    }

    this.jsonOk(response, {
      current_user_sys_id: currentUserId,
      result: rows,
    });
  },

  handlePatch: function (request, response) {
    var approvalSysId =
      request.pathParams && request.pathParams.sys_id
        ? request.pathParams.sys_id.toString()
        : '';
    if (!approvalSysId) {
      this.jsonError(response, 400, 'Missing sys_id in path');
      return;
    }

    var body = this.parseBody(request);
    if (!body) {
      this.jsonError(response, 400, 'Invalid JSON body');
      return;
    }

    var decision = body.decision;
    var comments = body.comments;
    var currentUserId = gs.getUserID();

    if (this.VALID_DECISIONS.indexOf(decision) === -1) {
      this.jsonError(response, 400, 'Invalid decision. Use approve or reject.');
      return;
    }

    if (decision === 'reject' && !comments) {
      this.jsonError(response, 400, 'Comments are required when rejecting.');
      return;
    }

    var gr = new GlideRecord(this.APPROVAL_TABLE);
    if (!gr.get(approvalSysId)) {
      this.jsonError(response, 404, 'Approval record not found');
      return;
    }

    var approver = this.sn(gr.getValue('approver'));
    var state = this.sn(gr.getValue('state'));
    var documentId = this.sn(gr.getValue('document_id'));

    if (!this.isRelationshipChangeDocument(documentId)) {
      this.jsonError(response, 400, 'Approval is not for a relationship change record');
      return;
    }

    if (state !== 'requested') {
      this.jsonError(response, 400, 'Only requested approvals can be decided');
      return;
    }

    if (approver !== currentUserId && !this.isAdminUser()) {
      this.jsonError(response, 403, 'Only the assigned approver can approve or reject');
      return;
    }

    if (decision === 'approve') {
      gr.setValue('state', 'approved');
    } else {
      gr.setValue('state', 'rejected');
      gr.setValue('comments', comments);
    }

    gr.update();
    gr.get(approvalSysId);
    this.jsonOk(response, { result: this.serializeApprovalRow(gr) });
  },

  type: 'RelationshipApprovalHandler',
};
