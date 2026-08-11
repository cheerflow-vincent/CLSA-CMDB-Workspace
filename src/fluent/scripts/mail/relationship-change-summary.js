(function runMailScript(/* GlideRecord */ current, /* TemplatePrinter */ template,
  /* Optional EmailOutbound */ email, /* Optional GlideRecord */ email_action,
  /* Optional GlideRecord */ event) {
  var changeGr = current;

  if (current.getTableName() === 'sysapproval_approver') {
    changeGr = new GlideRecord('x_citi4_clsa_cmd_0_relationship_change');
    if (!changeGr.get(current.getValue('document_id'))) {
      template.print('Relationship change details are unavailable.');
      return;
    }
  }

  var action = changeGr.getDisplayValue('action') || '';
  var direction = changeGr.getDisplayValue('direction') || '';
  var source = changeGr.getDisplayValue('source_ci') || '';
  var target = changeGr.getDisplayValue('target_ci') || '';
  var relType = changeGr.getValue('rel_type') || '';
  var requester = changeGr.getDisplayValue('requested_by') || '';

  template.print(
    action + ' | ' + direction + ' \u2014 ' + source + ' \u2194 ' + target
      + ' (' + relType + ') requested by ' + requester,
  );

  var comments = changeGr.getValue('approval_comments');
  if (comments) {
    template.print(' Comments: ' + comments);
  }
})(current, template, email, email_action, event);
