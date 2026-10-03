import {writeFileSync} from 'node:fs';
if(process.env.FIXTURE_GITHUB_ENV_LOG&&process.env.GH_CONFIG_DIR){
 writeFileSync(process.env.FIXTURE_GITHUB_ENV_LOG,JSON.stringify({githubConfig:process.env.GH_CONFIG_DIR,token:process.env.GH_TOKEN,gitGlobal:process.env.GIT_CONFIG_GLOBAL}));
}
