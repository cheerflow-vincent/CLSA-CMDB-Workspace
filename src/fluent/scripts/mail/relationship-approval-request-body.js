(function runMailScript(/* GlideRecord */ current, /* TemplatePrinter */ template,
  /* Optional EmailOutbound */ email, /* Optional GlideRecord */ email_action) {
  const changeGr = new GlideRecord('x_citi4_clsa_cmd_0_relationship_change');
  if (!changeGr.get(current.getValue('document_id'))) {
    email.setSubject('Approval required: relationship change');
    template.print('<p>Relationship change details are unavailable.</p>');
    return;
  }

  const action = changeGr.getDisplayValue('action') || '';
  const direction = changeGr.getDisplayValue('direction') || '';
  const source = changeGr.getDisplayValue('source_ci') || '';
  const target = changeGr.getDisplayValue('target_ci') || '';
  const relType = changeGr.getValue('rel_type') || '';
  const requester = changeGr.getDisplayValue('requested_by') || '';

  email.setSubject('Approval required: ' + action + ' | ' + direction + ' | ' + source + ' \u2194 ' + target);

  template.print('<p>');
  template.print(
    action + ' | ' + direction + ' \u2014 ' + source + ' \u2194 ' + target
      + ' (' + relType + ') requested by ' + requester
      + ' <strong>requires your approval</strong>. Reply using the links below, or open the CMDB portal.',
  );
  template.print('</p>');
})(current, template, email, email_action);
