(function runMailScript(/* GlideRecord */ current, /* TemplatePrinter */ template,
  /* Optional EmailOutbound */ email, /* Optional GlideRecord */ email_action,
  /* Optional GlideRecord */ event) {
  var changeGr = current;
  var prefix = '';

  if (current.getTableName() === 'sysapproval_approver') {
    prefix = 'Approval required: ';
    changeGr = new GlideRecord('x_citi4_clsa_cmd_0_relationship_change');
    if (!changeGr.get(current.getValue('document_id'))) {
      email.setSubject('Approval required: relationship change');
      return;
    }
  }

  var action = changeGr.getDisplayValue('action') || '';
  var direction = changeGr.getDisplayValue('direction') || '';
  var source = changeGr.getDisplayValue('source_ci') || '';
  var target = changeGr.getDisplayValue('target_ci') || '';
  var subject = action + ' | ' + direction + ' | ' + source + ' \u2194 ' + target;

  email.setSubject(prefix + subject);
})(current, template, email, email_action, event);
