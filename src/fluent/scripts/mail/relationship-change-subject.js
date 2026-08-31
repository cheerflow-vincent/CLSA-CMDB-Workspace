(function runMailScript(/* GlideRecord */ current, /* TemplatePrinter */ template,
  /* Optional EmailOutbound */ email, /* Optional GlideRecord */ email_action) {
  let changeGr = current;
  let prefix = '';

  if (current.getTableName() === 'sysapproval_approver') {
    prefix = 'Approval required: ';
    changeGr = new GlideRecord('x_citi4_clsa_cmd_0_relationship_change');
    if (!changeGr.get(current.getValue('document_id'))) {
      email.setSubject('Approval required: relationship change');
      return;
    }
  }

  const action = changeGr.getDisplayValue('action') || '';
  const direction = changeGr.getDisplayValue('direction') || '';
  const source = changeGr.getDisplayValue('source_ci') || '';
  const target = changeGr.getDisplayValue('target_ci') || '';
  const subject = action + ' | ' + direction + ' | ' + source + ' \u2194 ' + target;

  email.setSubject(prefix + subject);
})(current, template, email, email_action);
