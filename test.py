import asyncio
import base64
import json
import sys
import websockets
import ssl
from pydub import AudioSegment

subscribers = {}

def deepgram_connect():
    extra_headers = {
        'Authorization': 'd6057b09874c406d5f8ee9a65390bfd5ae6e6564'  # <-- Replace with your actual API key
    }
    deepgram_ws = websockets.connect(
        'wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&channels=2&multichannel=true',
        extra_headers=extra_headers
    )
    return deepgram_ws

async def twilio_handler(twilio_ws):
    audio_queue = asyncio.Queue()
    callsid_queue = asyncio.Queue()

    async with deepgram_connect() as deepgram_ws:

        async def deepgram_sender(deepgram_ws):
            print('deepgram_sender started')
            while True:
                chunk = await audio_queue.get()
                await deepgram_ws.send(chunk)

        async def deepgram_receiver(deepgram_ws):
            print('deepgram_receiver started')
            callsid = await callsid_queue.get()
            subscribers[callsid] = []
            async for message in deepgram_ws:
                for client in subscribers[callsid]:
                    client.put_nowait(message)

            for client in subscribers[callsid]:
                client.put_nowait('close')

            del subscribers[callsid]

        async def twilio_receiver(twilio_ws):
            print('twilio_receiver started')
            BUFFER_SIZE = 20 * 160
            inbuffer = bytearray(b'')
            outbuffer = bytearray(b'')
            inbound_chunks_started = False
            outbound_chunks_started = False
            latest_inbound_timestamp = 0
            latest_outbound_timestamp = 0
            async for message in twilio_ws:
                try:
                    data = json.loads(message)
                    if data['event'] == 'start':
                        start = data['start']
                        callsid = start['callSid']
                        callsid_queue.put_nowait(callsid)
                    if data['event'] == 'connected':
                        continue
                    if data['event'] == 'media':
                        media = data['media']
                        chunk = base64.b64decode(media['payload'])
                        if media['track'] == 'inbound':
                            if inbound_chunks_started:
                                if latest_inbound_timestamp + 20 < int(media['timestamp']):
                                    bytes_to_fill = 8 * (int(media['timestamp']) - (latest_inbound_timestamp + 20))
                                    inbuffer.extend(b'\xff' * bytes_to_fill)
                            else:
                                inbound_chunks_started = True
                                latest_inbound_timestamp = int(media['timestamp'])
                                latest_outbound_timestamp = int(media['timestamp']) - 20
                            latest_inbound_timestamp = int(media['timestamp'])
                            inbuffer.extend(chunk)
                        if media['track'] == 'outbound':
                            outbound_chunked_started = True
                            if latest_outbound_timestamp + 20 < int(media['timestamp']):
                                bytes_to_fill = 8 * (int(media['timestamp']) - (latest_outbound_timestamp + 20))
                                outbuffer.extend(b'\xff' * bytes_to_fill)
                            latest_outbound_timestamp = int(media['timestamp'])
                            outbuffer.extend(chunk)
                    if data['event'] == 'stop':
                        break

                    while len(inbuffer) >= BUFFER_SIZE and len(outbuffer) >= BUFFER_SIZE:
                        asinbound = AudioSegment(inbuffer[:BUFFER_SIZE], sample_width=1, frame_rate=8000, channels=1)
                        asoutbound = AudioSegment(outbuffer[:BUFFER_SIZE], sample_width=1, frame_rate=8000, channels=1)
                        mixed = AudioSegment.from_mono_audiosegments(asinbound, asoutbound)
                        audio_queue.put_nowait(mixed.raw_data)
                        inbuffer = inbuffer[BUFFER_SIZE:]
                        outbuffer = outbuffer[BUFFER_SIZE:]
                except:
                    break

            audio_queue.put_nowait(b'')

        await asyncio.wait([
            asyncio.ensure_future(deepgram_sender(deepgram_ws)),
            asyncio.ensure_future(deepgram_receiver(deepgram_ws)),
            asyncio.ensure_future(twilio_receiver(twilio_ws))
        ])

        await twilio_ws.close()

async def client_handler(client_ws):
    client_queue = asyncio.Queue()

    await client_ws.send(json.dumps(list(subscribers.keys())))

    try:
        callsid = await client_ws.recv()
        callsid = callsid.strip()
        if callsid in subscribers:
            subscribers[callsid].append(client_queue)
        else:
            await client_ws.close()
    except:
        await client_ws.close()

    async def client_sender(client_ws):
        while True:
            message = await client_queue.get()
            if message == 'close':
                break
            try:
                await client_ws.send(message)
            except:
                subscribers[callsid].remove(client_queue)
                break

    await asyncio.wait([
        asyncio.ensure_future(client_sender(client_ws)),
    ])

    await client_ws.close()

async def router(websocket, path):
    if path == '/client':
        print('client connection incoming')
        await client_handler(websocket)
    elif path == '/twilio':
        print('twilio connection incoming')
        await twilio_handler(websocket)

def main():
    # SSL setup
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain('/etc/letsencrypt/live/asdnj123123.xyz/fullchain.pem', '/etc/letsencrypt/live/asdnj123123.xyz/privkey.pem')  # <-- Update these paths

    server = websockets.serve(router, '0.0.0.0', 443, ssl=ssl_context)

    asyncio.run(server)  # Updated for Python 3.7+

if __name__ == '__main__':
    sys.exit(main() or 0)
