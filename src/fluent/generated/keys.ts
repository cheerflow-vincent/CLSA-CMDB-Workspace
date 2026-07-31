import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    bom_json: {
                        table: 'sys_module'
                        id: '6c04a20d6676451f84a69aaf721b78f8'
                    }
                    'cmdb-rel-ci-portal-create-acl': {
                        table: 'sys_security_acl'
                        id: '4db0fe301f8a43b3a12fe5be5467a83f'
                        deleted: true
                    }
                    'cmdb-rel-ci-portal-delete-acl': {
                        table: 'sys_security_acl'
                        id: 'a88b90351acc43a5aa6d7c16aa8a4fce'
                        deleted: true
                    }
                    'field-access-param-fields': {
                        table: 'sys_ws_query_parameter'
                        id: '4fcd676a067b4baab5f10115b5db1e5b'
                    }
                    'field-access-param-sys-id': {
                        table: 'sys_ws_query_parameter'
                        id: 'c430245e88ac4438a87c9b05f9f0f120'
                    }
                    'field-access-param-table': {
                        table: 'sys_ws_query_parameter'
                        id: '82ea99fec5e64848a9183e029e4c6fee'
                    }
                    'field-access-route': {
                        table: 'sys_ws_operation'
                        id: '0501f1a415b84bcf95657933e17ef0fe'
                    }
                    'node_modules/@xyflow/react/dist/style.css': {
                        table: 'sys_ux_theme_asset'
                        id: '230518c067474df3915ea3148ed90e7f'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '555d9b4bb51e4be4b47e7529d4b0a91a'
                    }
                    'portal-rest-api': {
                        table: 'sys_ws_definition'
                        id: '1127096dc55c4a5a98df6f7770ceb78b'
                    }
                    'relationship-approval-handler': {
                        table: 'sys_script_include'
                        id: '22d52944a24a45298aa0232ad5bdfbfa'
                    }
                    'relationship-approval-list-route': {
                        table: 'sys_ws_operation'
                        id: '6b61f2525a1d4c67bf7cfd3bad2bc31b'
                    }
                    'relationship-approval-param-ci': {
                        table: 'sys_ws_query_parameter'
                        id: 'c078d267d8ed48868cd9b7feea9645fc'
                    }
                    'relationship-approval-param-document': {
                        table: 'sys_ws_query_parameter'
                        id: 'f228d4ef9cb94fe9b5aed1e0ba629355'
                    }
                    'relationship-approval-param-id': {
                        table: 'sys_ws_query_parameter'
                        id: '0066dd866d7c49dc98257be56e9af7fd'
                    }
                    'relationship-approval-param-inbox': {
                        table: 'sys_ws_query_parameter'
                        id: '908dc5e3b661492996190bdeaa83d7b6'
                    }
                    'relationship-approval-patch-route': {
                        table: 'sys_ws_operation'
                        id: 'ff1aa2cbf567416da41f93ef31924eec'
                    }
                    'relationship-change-create-acl': {
                        table: 'sys_security_acl'
                        id: 'd78bc918bafb47ccbf4f0334baba05e3'
                        deleted: true
                    }
                    'relationship-change-create-route': {
                        table: 'sys_ws_operation'
                        id: '78842a1fa3454011a2396bf81fd02f36'
                    }
                    'relationship-change-delete-acl': {
                        table: 'sys_security_acl'
                        id: '1ea96d10fa2b441695ba69a336ce1ca2'
                        deleted: true
                    }
                    'relationship-change-handler': {
                        table: 'sys_script_include'
                        id: '4b26b352a4c142b9bec83be9ea65beb6'
                    }
                    'relationship-change-list-route': {
                        table: 'sys_ws_operation'
                        id: 'd656ce658c414c8eb74175d02d0105a1'
                    }
                    'relationship-change-param-ci': {
                        table: 'sys_ws_query_parameter'
                        id: '967e09854f5e4c2588f04f4c2bc22b14'
                    }
                    'relationship-change-param-id': {
                        table: 'sys_ws_query_parameter'
                        id: 'a344d1417d434ba18d591245f7804dbc'
                        deleted: true
                    }
                    'relationship-change-param-inbox': {
                        table: 'sys_ws_query_parameter'
                        id: '61d8035450bb43a08a753df8ba0a9903'
                        deleted: true
                    }
                    'relationship-change-param-state': {
                        table: 'sys_ws_query_parameter'
                        id: 'b36643c73dbf4b969ff852b398e782f7'
                        deleted: true
                    }
                    'relationship-change-patch-route': {
                        table: 'sys_ws_operation'
                        id: 'b4fbc50a51b144a0ab2084d485530a0e'
                        deleted: true
                    }
                    'relationship-change-read-acl': {
                        table: 'sys_security_acl'
                        id: '7b1208a751cf4ed8b9b6466b7a8dc98c'
                        deleted: true
                    }
                    'relationship-change-write-acl': {
                        table: 'sys_security_acl'
                        id: 'b6f584842c464dda8a6a876b6184f365'
                        deleted: true
                    }
                    'tailwind.css': {
                        table: 'sys_ux_theme_asset'
                        id: '12fe43160c434582b4ccd80f33c9e68d'
                    }
                }
                composite: [
                    {
                        table: 'sys_documentation'
                        id: '0071491533624440b3118620b5593e95'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'state'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: '02da9ca922d548ebb4810f4a627796ff'
                        deleted: true
                        key: {
                            web_service_operation: 'b4fbc50a51b144a0ab2084d485530a0e'
                            web_service_query_parameter: 'a344d1417d434ba18d591245f7804dbc'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '03c9470302c14ee296a15ea1fa879c3d'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'approval_comments'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '0cc8cff827a44c1d8d115f17eb8be790'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'parent_ci'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '10f5e01dd9924b55b714244e8d29880c'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'direction'
                            value: 'downstream'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '12757da7f7db47e99ac59fa9e7bfc292'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'relationship'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '12fb838c1b3d46889f6ff29197bc2fac'
                        deleted: true
                        key: {
                            application_file: 'a6ff275af19d4071ae4d4c1d328f08cc'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '158da2cb61774ed380e223386dc5e97f'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'requested_by'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: '16996cdc9e73446d8e59595680479b3f'
                        deleted: true
                        key: {
                            name: 'x_citi4_clsa_cmd_0/vendor-@xyflow-react--55457671'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: '1aa19e67310040e9aa8f3ae17cd9f24d'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'action'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '1e9248e1b3af404394d1a7c70444d90e'
                        deleted: true
                        key: {
                            application_file: 'dfea020d367a405c90280b9265f38651'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '1eaaddb78c334d4b83478dc7cba5779f'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'state'
                            value: 'cancelled'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: '27c5f83a2a4c4723b9e5fcc0ba2e505b'
                        deleted: true
                        key: {
                            web_service_operation: 'd656ce658c414c8eb74175d02d0105a1'
                            web_service_query_parameter: 'b36643c73dbf4b969ff852b398e782f7'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '2e04adc42c1f4318a124465b4029d768'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'state'
                            value: 'pending_approval'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '3510448d0d414b5ab8b6f7c54baaf269'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'approver'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: '378d58908e6c42fc90526384e542ff14'
                        deleted: true
                        key: {
                            web_service_operation: 'd656ce658c414c8eb74175d02d0105a1'
                            web_service_query_parameter: '61d8035450bb43a08a753df8ba0a9903'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '38ca2067b5364cd9a46d734a551f4e98'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'target_ci'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '3a46d22dc52246cc9e575cb241adf430'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'NULL'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '3bfba474a4ad4cfda87303c14e23977e'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'action'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '3d58a4e54f7045bab6afc836df834205'
                        key: {
                            application_file: 'f4005b3431ff412cb959ec272c5f5f7b'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: '401010e1ba3c4039a0464ab57d279197'
                        key: {
                            web_service_operation: 'd656ce658c414c8eb74175d02d0105a1'
                            web_service_query_parameter: '967e09854f5e4c2588f04f4c2bc22b14'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '44ad039f116d411fabb4a46041f6784a'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'child_ci'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '45ce5acbe3884e68b74e303dd1ec2d23'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'direction'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '4903cb7c29804cf4941cdb5512e480c1'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'state'
                            value: 'rejected'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: '49da06806cc340e3a16d4cf3c6050608'
                        key: {
                            name: 'x_citi4_clsa_cmd_0/main'
                        }
                    },
                    {
                        table: 'ua_table_licensing_config'
                        id: '4a7e14e3ee8545a2a91b90772242559e'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '4b36be7fbcf54a7cb7ebefeba6429ca3'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'direction'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '52b7db34c58c4b6e9859931e53dd3e40'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'action'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '588ec771a04a43a6acfaa13686468baa'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'target_ci'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '5b33a344c25b47eeba275303739ef775'
                        deleted: true
                        key: {
                            application_file: 'f30de00a0a1b4789936f4272f0f780dd'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: '5f9b13b8c99747878f8217b837ffb95b'
                        key: {
                            name: 'x_citi4_clsa_cmd_0/main.js.map'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '61325f4726fd48728bcccfac5c8fd3e2'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'NULL'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact'
                        id: '6405c54011db45a9b600cb1694d8bdc9'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_cmdb_portal.do - BYOUI Files'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '770dda4461c04a54a78722e1a31edb8f'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'rel_type'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: '7851a1c263b64c6f83649f01312e587a'
                        key: {
                            web_service_operation: '0501f1a415b84bcf95657933e17ef0fe'
                            web_service_query_parameter: '82ea99fec5e64848a9183e029e4c6fee'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '7d07f6299958479bb37c710de3ec7c90'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'requested_by'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '8275b0f887614a61aee92636811db63d'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'approver'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '84d40fa54e25459c839f6c58c714ab32'
                        deleted: true
                        key: {
                            application_file: '5f9b13b8c99747878f8217b837ffb95b'
                            source_artifact: 'c434b02860ec483897a32e470d737de0'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: '8a14a965476d42adbd301e34b4135ad8'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'direction'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '8bfc8fdd63d745838a44328934cd59a4'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'direction'
                            value: 'upstream'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: '979901f9459542a08a4a9d12764053ec'
                        key: {
                            web_service_operation: '6b61f2525a1d4c67bf7cfd3bad2bc31b'
                            web_service_query_parameter: '908dc5e3b661492996190bdeaa83d7b6'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: '9a73ff3241454cada50e325c1c006b04'
                        key: {
                            web_service_operation: 'ff1aa2cbf567416da41f93ef31924eec'
                            web_service_query_parameter: '0066dd866d7c49dc98257be56e9af7fd'
                        }
                    },
                    {
                        table: 'sys_ui_page'
                        id: '9dca87668740407c9f31d9848f061194'
                        deleted: true
                        key: {
                            endpoint: 'x_citi4_clsa_cmd_0_cmdb_portal_v2.do'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '9f38be037feb476ba8c0da69eec37e1b'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'parent_ci'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'a55a424cf43741eeb31dbee95aad27d4'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'action'
                            value: 'delete'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: 'a6ff275af19d4071ae4d4c1d328f08cc'
                        deleted: true
                        key: {
                            name: 'x_citi4_clsa_cmd_0/vendor-@xyflow-react--55457671.js.map'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'aa2943c1d84344ec9c2c4088a1345af7'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'state'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'ab277b1c4db0485bb2ed46ea3b142674'
                        key: {
                            application_file: '49da06806cc340e3a16d4cf3c6050608'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: 'aeff28dbb3964e86823a78fd01e7f942'
                        key: {
                            web_service_operation: '6b61f2525a1d4c67bf7cfd3bad2bc31b'
                            web_service_query_parameter: 'c078d267d8ed48868cd9b7feea9645fc'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'b2f2ac61b6da4e308eedcb67b9fcd907'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'state'
                            value: 'completed'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'b60a6b3602a941beaacc086e1804d245'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'action'
                            value: 'create'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'b88977736fad40a6931e77f4cd667d8c'
                        key: {
                            application_file: '5f9b13b8c99747878f8217b837ffb95b'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: 'b924e1df57114497878bcee964b31f14'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'state'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'baff0e23b1274fa2a3e2fc351004d2e6'
                        deleted: true
                        key: {
                            application_file: '9dca87668740407c9f31d9848f061194'
                            source_artifact: 'c434b02860ec483897a32e470d737de0'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'c07b8c55021d45a4aa4bc4ffcce26a85'
                        deleted: true
                        key: {
                            application_file: '16996cdc9e73446d8e59595680479b3f'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: 'c254e1a494694e789e48aea3619e235d'
                        key: {
                            web_service_operation: '0501f1a415b84bcf95657933e17ef0fe'
                            web_service_query_parameter: 'c430245e88ac4438a87c9b05f9f0f120'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'c37c1d26dd214b4ba18f4891bf3c10b3'
                        deleted: true
                        key: {
                            application_file: '49da06806cc340e3a16d4cf3c6050608'
                            source_artifact: 'c434b02860ec483897a32e470d737de0'
                        }
                    },
                    {
                        table: 'sn_glider_source_artifact'
                        id: 'c434b02860ec483897a32e470d737de0'
                        deleted: true
                        key: {
                            name: 'x_citi4_clsa_cmd_0_cmdb_portal_v2.do - BYOUI Files'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'd84c06e21aff4eb0a528ba4e3257b19e'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'source_ci'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: 'dfea020d367a405c90280b9265f38651'
                        deleted: true
                        key: {
                            name: 'x_citi4_clsa_cmd_0/vendor-lucide-react--3e815e09'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'e01d5cdc123b4dbfaa7d80c7ef71d47b'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'child_ci'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'e13f2e7d1c2c4b26affab951e09aa03b'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'completed_at'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'e1fbea2dc4f347b2b254d2a375078b94'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'relationship'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'e36cd7dac609482ba9da3c4ad8e94d0b'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'completed_at'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'e3a1ee69a4cd4d47ba12835913b2419c'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'requested_at'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'ebf5a2b7cef34fbc85fb69f7a0c83f64'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'rel_type'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: 'efb662b03c9e480c82e86e1eaeb99a12'
                        key: {
                            web_service_operation: '0501f1a415b84bcf95657933e17ef0fe'
                            web_service_query_parameter: '4fcd676a067b4baab5f10115b5db1e5b'
                        }
                    },
                    {
                        table: 'sys_ws_query_parameter_map'
                        id: 'f11b881ce90344739f73d524552f33f0'
                        key: {
                            web_service_operation: '6b61f2525a1d4c67bf7cfd3bad2bc31b'
                            web_service_query_parameter: 'f228d4ef9cb94fe9b5aed1e0ba629355'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: 'f20e4618c07049d1bc01d196d0e804bd'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'direction'
                            value: 'bidirectional'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'f2110afc989b49b3be0054317844971a'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'source_ci'
                        }
                    },
                    {
                        table: 'sys_ux_lib_asset'
                        id: 'f30de00a0a1b4789936f4272f0f780dd'
                        deleted: true
                        key: {
                            name: 'x_citi4_clsa_cmd_0/vendor-lucide-react--3e815e09.js.map'
                        }
                    },
                    {
                        table: 'sys_ui_page'
                        id: 'f4005b3431ff412cb959ec272c5f5f7b'
                        key: {
                            endpoint: 'x_citi4_clsa_cmd_0_cmdb_portal.do'
                        }
                    },
                    {
                        table: 'sys_db_object'
                        id: 'f59539542422450c95e37f976585081c'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'f8b6348cf9704307ae1b6d15c00a1bd3'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'requested_at'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'f8d678247b9b40029dad06f2a0ecec32'
                        key: {
                            name: 'x_citi4_clsa_cmd_0_relationship_change'
                            element: 'approval_comments'
                        }
                    },
                ]
            }
        }
    }
}
