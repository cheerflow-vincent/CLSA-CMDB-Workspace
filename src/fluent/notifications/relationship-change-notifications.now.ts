import '@servicenow/sdk/global'
import { EmailNotification, Record } from '@servicenow/sdk/core'

const ITSM_GROUP_SYS_ID = '21437a351ba8f514c42f21ffe54bcb9f'
const CHANGE_TABLE = 'x_citi4_clsa_cmd_0_relationship_change'

Record({
  $id: Now.ID['rel-change-mail-subject'],
  table: 'sys_script_email',
  data: {
    name: 'Relationship Change Subject',
    new_lines_to_html: false,
    script: Now.include('../scripts/mail/relationship-change-subject.js'),
  },
})

Record({
  $id: Now.ID['rel-change-mail-details'],
  table: 'sys_script_email',
  data: {
    name: 'Relationship Change Summary',
    new_lines_to_html: false,
    script: Now.include('../scripts/mail/relationship-change-summary.js'),
  },
})

Record({
  $id: Now.ID['rel-change-mail-portal-link'],
  table: 'sys_script_email',
  data: {
    name: 'Relationship Change Portal Link',
    new_lines_to_html: false,
    script: Now.include('../scripts/mail/relationship-change-portal-link.js'),
  },
})

Record({
  $id: Now.ID['rel-change-mail-approval-body'],
  table: 'sys_script_email',
  data: {
    name: 'Relationship Approval Request Body',
    new_lines_to_html: false,
    script: Now.include('../scripts/mail/relationship-approval-request-body.js'),
  },
})

export const rel_change_notif_pending = EmailNotification({
  $id: Now.ID['rel-change-notif-pending'],
  table: CHANGE_TABLE,
  name: 'Relationship Change Pending Approval',
  description: 'Notify IT Service Management when a relationship change is pending approval',
  active: true,
  triggerConditions: {
    generationType: 'engine',
    onRecordInsert: true,
    condition: 'state=pending_approval^EQ',
  },
  recipientDetails: {
    recipientGroups: [ITSM_GROUP_SYS_ID],
    sendToCreator: false,
  },
  emailContent: {
    subject: 'Relationship change pending approval',
    messageHtml: `\${mail_script:Relationship Change Subject}
<p>\${mail_script:Relationship Change Summary} is <strong>pending approval</strong>.</p>
\${mail_script:Relationship Change Portal Link}`,
  },
})

export const rel_change_notif_approval = EmailNotification({
  $id: Now.ID['rel-change-notif-approval'],
  table: 'sysapproval_approver',
  name: 'Relationship Change Approval Request',
  description: 'Notify approver when a relationship change approval is requested',
  active: true,
  triggerConditions: {
    generationType: 'engine',
    onRecordInsert: true,
    condition: 'state=requested^EQ',
    advancedCondition: `(function() {
  if (!current.document_id) return false;
  var gr = new GlideRecord('${CHANGE_TABLE}');
  return gr.get(current.document_id);
})();`,
  },
  recipientDetails: {
    recipientFields: ['approver'],
    sendToCreator: false,
  },
  emailContent: {
    subject: 'Approval required: relationship change',
    messageHtml: `\${mail_script:Relationship Approval Request Body}
<p>\${mailto:mailto.approval} \${mailto:mailto.rejection}</p>
\${mail_script:Relationship Change Portal Link}`,
  },
})

export const rel_change_notif_approved = EmailNotification({
  $id: Now.ID['rel-change-notif-approved'],
  table: CHANGE_TABLE,
  name: 'Relationship Change Approved',
  description: 'Notify IT Service Management and requester when a relationship change is approved',
  active: true,
  triggerConditions: {
    generationType: 'engine',
    onRecordUpdate: true,
    condition: 'state=completed^stateVALCHANGES^EQ',
  },
  recipientDetails: {
    recipientGroups: [ITSM_GROUP_SYS_ID],
    recipientFields: ['requested_by'],
    sendToCreator: false,
  },
  emailContent: {
    subject: 'Relationship change approved',
    messageHtml: `\${mail_script:Relationship Change Subject}
<p>\${mail_script:Relationship Change Summary} has been <strong>approved</strong>.</p>
\${mail_script:Relationship Change Portal Link}`,
  },
})

export const rel_change_notif_rejected = EmailNotification({
  $id: Now.ID['rel-change-notif-rejected'],
  table: CHANGE_TABLE,
  name: 'Relationship Change Rejected',
  description: 'Notify IT Service Management and requester when a relationship change is rejected',
  active: true,
  triggerConditions: {
    generationType: 'engine',
    onRecordUpdate: true,
    condition: 'state=rejected^stateVALCHANGES^EQ',
  },
  recipientDetails: {
    recipientGroups: [ITSM_GROUP_SYS_ID],
    recipientFields: ['requested_by'],
    sendToCreator: false,
  },
  emailContent: {
    subject: 'Relationship change rejected',
    messageHtml: `\${mail_script:Relationship Change Subject}
<p>\${mail_script:Relationship Change Summary} has been <strong>rejected</strong>.</p>
\${mail_script:Relationship Change Portal Link}`,
  },
})

export const rel_change_notif_completed_create = EmailNotification({
  $id: Now.ID['rel-change-notif-completed-create'],
  table: CHANGE_TABLE,
  name: 'Relationship Change Completed on Create',
  description: 'Notify IT Service Management and requester when a relationship change is completed on insert',
  active: true,
  triggerConditions: {
    generationType: 'engine',
    onRecordInsert: true,
    condition: 'state=completed^EQ',
  },
  recipientDetails: {
    recipientGroups: [ITSM_GROUP_SYS_ID],
    recipientFields: ['requested_by'],
    sendToCreator: false,
  },
  emailContent: {
    subject: 'Relationship change completed',
    messageHtml: `\${mail_script:Relationship Change Subject}
<p>\${mail_script:Relationship Change Summary} has been <strong>completed</strong>.</p>
\${mail_script:Relationship Change Portal Link}`,
  },
})
