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
                    'node_modules/@xyflow/react/dist/style.css': {
                        table: 'sys_ux_theme_asset'
                        id: '230518c067474df3915ea3148ed90e7f'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '555d9b4bb51e4be4b47e7529d4b0a91a'
                    }
                    'tailwind.css': {
                        table: 'sys_ux_theme_asset'
                        id: '12fe43160c434582b4ccd80f33c9e68d'
                    }
                }
                composite: [
                    {
                        table: 'sn_glider_source_artifact_m2m'
                        id: '3d58a4e54f7045bab6afc836df834205'
                        key: {
                            application_file: 'f4005b3431ff412cb959ec272c5f5f7b'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
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
                        table: 'sys_ux_lib_asset'
                        id: '5f9b13b8c99747878f8217b837ffb95b'
                        key: {
                            name: 'x_citi4_clsa_cmd_0/main.js.map'
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
                        table: 'sn_glider_source_artifact_m2m'
                        id: '84d40fa54e25459c839f6c58c714ab32'
                        deleted: true
                        key: {
                            application_file: '5f9b13b8c99747878f8217b837ffb95b'
                            source_artifact: 'c434b02860ec483897a32e470d737de0'
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
                        table: 'sn_glider_source_artifact_m2m'
                        id: 'ab277b1c4db0485bb2ed46ea3b142674'
                        key: {
                            application_file: '49da06806cc340e3a16d4cf3c6050608'
                            source_artifact: '6405c54011db45a9b600cb1694d8bdc9'
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
                        table: 'sys_ui_page'
                        id: 'f4005b3431ff412cb959ec272c5f5f7b'
                        key: {
                            endpoint: 'x_citi4_clsa_cmd_0_cmdb_portal.do'
                        }
                    },
                ]
            }
        }
    }
}
