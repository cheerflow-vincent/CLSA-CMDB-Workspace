(function runMailScript(/* GlideRecord */ current, /* TemplatePrinter */ template,
  /* Optional EmailOutbound */ email, /* Optional GlideRecord */ email_action,
  /* Optional GlideRecord */ event) {
  var changeGr = new GlideRecord('x_citi4_clsa_cmd_0_relationship_change');
  if (!changeGr.get(current.getValue('document_id'))) {
    email.setSubject('Approval required: relationship change');
    template.print('<p>Relationship change details are unavailable.</p>');
    return;
  }

  var action = changeGr.getDisplayValue('action') || '';
  var direction = changeGr.getDisplayValue('direction') || '';
  var source = changeGr.getDisplayValue('source_ci') || '';
  var target = changeGr.getDisplayValue('target_ci') || '';
  var relType = changeGr.getValue('rel_type') || '';
  var requester = changeGr.getDisplayValue('requested_by') || '';

  email.setSubject('Approval required: ' + action + ' | ' + direction + ' | ' + source + ' \u2194 ' + target);

  template.print('<p>');
  template.print(
    action + ' | ' + direction + ' \u2014 ' + source + ' \u2194 ' + target
      + ' (' + relType + ') requested by ' + requester
      + ' <strong>requires your approval</strong>. Reply using the links below, or open the CMDB portal.',
  );
  template.print('</p>');
})(current, template, email, email_action, event);
