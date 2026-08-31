(function runMailScript(/* GlideRecord */ current, /* TemplatePrinter */ template,
  /* Optional EmailOutbound */ email, /* Optional GlideRecord */ email_action) {
  let changeGr = current;

  if (current.getTableName() === 'sysapproval_approver') {
    changeGr = new GlideRecord('x_citi4_clsa_cmd_0_relationship_change');
    if (!changeGr.get(current.getValue('document_id'))) {
      template.print('Relationship change details are unavailable.');
      return;
    }
  }

  const action = changeGr.getDisplayValue('action') || '';
  const direction = changeGr.getDisplayValue('direction') || '';
  const source = changeGr.getDisplayValue('source_ci') || '';
  const target = changeGr.getDisplayValue('target_ci') || '';
  const relType = changeGr.getValue('rel_type') || '';
  const requester = changeGr.getDisplayValue('requested_by') || '';

  template.print(
    action + ' | ' + direction + ' \u2014 ' + source + ' \u2194 ' + target
      + ' (' + relType + ') requested by ' + requester,
  );

  const comments = changeGr.getValue('approval_comments');
  if (comments) {
    template.print(' Comments: ' + comments);
  }
})(current, template, email, email_action);
