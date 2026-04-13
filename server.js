require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Rcon } = require('rcon-client');
const { Tail } = require('tail');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server,{
    cors:{ origin: "*" }
});

// 본인의 마인크래프트 서버 폴더 안에 있는 logs/latest.log 파일의 전체 경로를 적어주세요.
// 예: 'C:/Users/Desktop/Server/logs/latest.log'
const logPath = process.env.MC_LOG_PATH;
// ----------------------------------

const tail = new Tail(logPath, {
    fromBeginning: false,  // 실행 시점 이전의 로그는 무시
    follow: true,          // 파일이 업데이트되면 계속 추적
    useWatchFile: true,    // 윈도우에서 파일 변화를 더 잘 감지하게 함 (핵심!)
    fsWatchOptions: { interval: 500 } // 0.5초마다 파일이 바뀌었는지 체크
});
tail.on("line", (data) => {
    console.log("새로운 로그 발견:", data); // 터미널 창에 로그가 찍히는지 확인용
    io.emit('server_log', data);
});
const sendCommand = async (command) => {
    try {
        const rcon = await Rcon.connect({
            host: "localhost",
            port: 25575,
            password: process.env.MC_RCON_PASSWORD,
        });
        const response = await rcon.send(command);
        await rcon.end();
        return response;
    } catch (err) {
        console.error("RCON 오류:", err);
        return "RCON 연결에 실패했습니다.";
    }
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    socket.on('send_command', async (cmd) => {
        const res = await sendCommand(cmd);
        socket.emit('server_log', `> ${cmd}\n${res}`);
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('웹 서버가 실행되었습니다. 포트:3000');
});