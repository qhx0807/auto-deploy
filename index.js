#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');
const node_ssh = require('node-ssh');
const archiver = require('archiver');
const chalk = require('chalk');
const ora = require('ora');

const deployConfigPath = path.join(process.cwd(), '/deploy.config.js');

if (!fs.existsSync(deployConfigPath)) {
  console.log(chalk.yellow('deploy.config.js does not exist!'));
  process.exit(1);
}

const deployConfig = require(deployConfigPath);
const { projectName } = deployConfig;
const env = process.argv.slice(2)[0];
const config = deployConfig[env];
const { serveDir, sshConf, localDir, buildScript }  = config;

const ssh = new node_ssh();
const projectDir = process.cwd();

function execBuild() {
  if (!buildScript) {
    return;
  }
  try {
    const spinner = ora({
      text: chalk.magenta(`正在打包 ${buildScript}`),
      color: 'magenta'
    });
    spinner.start();
    childProcess.execSync(buildScript, { cwd: projectDir });
    spinner.stop();
    console.log(chalk.green(`0. 构建成功 ${buildScript}`))
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
}

function startZip() {
  return new Promise((resolve, reject) => {
    console.log('开始打包压缩dist...');
    const distPath = path.join(projectDir, localDir)
    const archive = archiver('zip', {
      zlib: { level: 9 }
    }).on('error', err => {
      throw err;
    });
    const output = fs.createWriteStream(`${projectDir}/dist.zip`).on('close', err => {
      if (err) {
        console.log('关闭archiver异常:' + err);
        reject(err);
        throw err;
      }
      console.log(chalk.green('1. dist.zip 打包成功'));
      resolve();
    });
    archive.pipe(output);
    archive.directory(distPath, '/');
    archive.finalize();
  })
}

async function connectSSH() {
  try {
    console.log(`正在连接到${sshConf.host}:${sshConf.port}`)
    await ssh.connect(sshConf);
    console.log(chalk.green('2. SSH连接成功'));
  } catch (error) {
    console.log(chalk.yellow(`SSH连接失败${error}`));
    process.exit(1);
  }
}

async function uploadFile() {
  try {
    console.log('正在上传文件至服务器目录');
    await ssh.putFile(`${projectDir}/dist.zip`, `${serveDir}/dist.zip`);
    console.log(chalk.green('3. 文件dist.zip上传成功'))
  } catch (error) {
    console.log(`文件传输异常${error}`);
    process.exit(1);
  }
}

async function runCommand(command) {
  await ssh.execCommand(command, { cwd: serveDir })
}

async function unZipFile() {
  try {
    console.log('开始解压dist.zip');
    await runCommand(`cd ${serveDir}`);
    await runCommand('unzip -o dist.zip && rm -f dist.zip');
    console.log(chalk.green('4. 解压成功'));
  } catch (error) {
    console.log(`zip解压失败：${error}`);
    process.exit(1);
  }
}

async function deleteLocalFile() {
  return new Promise((resolve, reject) => {
    console.log('开始删除本地压缩包：dist.zip');
    fs.unlink(`${projectDir}/dist.zip`, err => {
      if (err) {
        console.log(`本地dist.zip删除失败:${err}`);
        reject(err);
        process.exit(1);
      }
      console.log(chalk.green('本地dist.zip删除成功\n'));
      resolve()
    })
  })
}

async function deploy() {
  execBuild();
  await startZip();
  await connectSSH();
  await uploadFile();
  await unZipFile();
  await deleteLocalFile();
  console.log(chalk.bgCyan(`${projectName}项目部署完成^_^\n`))
  process.exit(0);
}

deploy();
