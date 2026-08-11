(function runMailScript(/* GlideRecord */ current, /* TemplatePrinter */ template,
  /* Optional EmailOutbound */ email, /* Optional GlideRecord */ email_action,
  /* Optional GlideRecord */ event) {
  var base = gs.getProperty('glide.servlet.uri');
  var portalUrl = base + 'x_citi4_clsa_cmd_0_cmdb_portal.do?page=rel-approvals';
  template.print('<p><a href="' + portalUrl + '">View Relationship Approvals</a></p>');
})(current, template, email, email_action, event);
