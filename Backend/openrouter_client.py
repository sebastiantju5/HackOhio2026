"""Server-only, bounded OpenRouter chat transport. Never echo upstream bodies."""

import json
import os
from socket import timeout
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class JourneyError(RuntimeError):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def model_name():
    return os.environ.get('OPENROUTER_MODEL', 'openai/gpt-4.1-mini')


def configured():
    return bool(os.environ.get('OPENROUTER_API_KEY', '').strip())


def complete(messages, tools, response_schema, *, final=False):
    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if not key:
        raise JourneyError('The journey agent is not configured on this server.', 503)
    payload = {'model': model_name(), 'messages': messages, 'temperature': .2, 'max_tokens': 1200,
               'provider': {'require_parameters': True, 'data_collection': 'deny'},
               'response_format': {'type': 'json_schema', 'json_schema': {'name': 'journey_answer', 'strict': True, 'schema': response_schema}},
               'tools': tools, 'tool_choice': 'none' if final else 'auto'}
    request = Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(payload).encode(), method='POST',
                      headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                               'X-OpenRouter-Title': 'WeatherWay Journey', 'HTTP-Referer': 'http://localhost:5173'})
    for attempt in range(2):
        try:
            with urlopen(request, timeout=25) as response:
                raw = response.read(256_001)
            if len(raw) > 256_000:
                raise JourneyError('The journey agent returned an oversized response.')
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError()
            if data.get('error'):
                if attempt == 0:
                    import time; time.sleep(1.2)
                    continue
                raise JourneyError('OpenRouter could not complete the request. Check the configured model and provider availability.', 503)
            message = data['choices'][0]['message']
            if not isinstance(message, dict):
                raise ValueError()
            usage = data.get('usage') if isinstance(data.get('usage'), dict) else {}
            return message, {key: usage[key] for key in ('prompt_tokens', 'completion_tokens', 'total_tokens') if isinstance(usage.get(key), int)}
        except HTTPError as error:
            if attempt == 0 and error.code in (429, 502, 503):
                import time; time.sleep(1.2)
                continue
            status = error.code
            if status in (401, 403):
                raise JourneyError('OpenRouter rejected the server credentials or provider access.', 503) from None
            if status == 402:
                raise JourneyError('OpenRouter credits or the API key spending limit have been reached.', 503) from None
            if status == 429:
                raise JourneyError('OpenRouter is rate limited. Try again later.', 429) from None
            raise JourneyError('OpenRouter could not complete this request. Check model availability and try again.', 503) from None
        except (timeout, TimeoutError):
            if attempt == 0:
                import time; time.sleep(1)
                continue
            raise JourneyError('The journey agent timed out. Try a shorter question.', 504) from None
        except (URLError, OSError, ValueError, KeyError, IndexError, TypeError):
            if attempt == 0:
                import time; time.sleep(1)
                continue
            raise JourneyError('The journey agent could not be reached or returned an invalid response.', 503) from None
    raise JourneyError('The journey agent could not complete this request. Check model availability and try again.', 503)


def stream_complete(messages, tools, response_schema, *, final=False):
    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if not key:
        raise JourneyError('The journey agent is not configured on this server.', 503)
    payload = {'model': model_name(), 'messages': messages, 'temperature': .2, 'max_tokens': 1200,
               'stream': True,
               'provider': {'require_parameters': True, 'data_collection': 'deny'},
               'response_format': {'type': 'json_schema', 'json_schema': {'name': 'journey_answer', 'strict': True, 'schema': response_schema}},
               'tools': tools, 'tool_choice': 'none' if final else 'auto'}
    request = Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(payload).encode(), method='POST',
                      headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                               'X-OpenRouter-Title': 'WeatherWay Journey', 'HTTP-Referer': 'http://localhost:5173'})

    accumulated_content = []
    accumulated_tool_calls = {}
    usage_dict = {}
    raw_bytes_read = 0

    try:
        with urlopen(request, timeout=25) as response:
            content_type = response.headers.get('Content-Type', '') if hasattr(response, 'headers') else ''
            if 'text/event-stream' not in content_type:
                raw = response.read(256_001)
                data = json.loads(raw)
                if data.get('error'):
                    raise ValueError('OpenRouter returned error')
                message = data['choices'][0]['message']
                usage = data.get('usage') if isinstance(data.get('usage'), dict) else {}
                usage_clean = {k: usage[k] for k in ('prompt_tokens', 'completion_tokens', 'total_tokens') if isinstance(usage.get(k), int)}
                if message.get('content'):
                    yield ('delta', message['content'])
                yield ('message', message, usage_clean)
                return

            for line in response:
                raw_bytes_read += len(line)
                if raw_bytes_read > 256_000:
                    raise JourneyError('The journey agent returned an oversized response.')
                line_str = line.decode('utf-8', errors='replace').strip()
                if not line_str or line_str.startswith(':'):
                    continue
                if line_str.startswith('data: '):
                    data_str = line_str[6:].strip()
                    if data_str == '[DONE]':
                        break
                    try:
                        chunk = json.loads(data_str)
                    except ValueError:
                        continue
                    if chunk.get('error'):
                        raise ValueError('OpenRouter chunk error')
                    choices = chunk.get('choices') or []
                    if not choices:
                        if chunk.get('usage') and isinstance(chunk['usage'], dict):
                            usage_dict.update({k: chunk['usage'][k] for k in ('prompt_tokens', 'completion_tokens', 'total_tokens') if isinstance(chunk['usage'].get(k), int)})
                        continue
                    delta = choices[0].get('delta') or {}
                    if 'content' in delta and delta['content']:
                        accumulated_content.append(delta['content'])
                        yield ('delta', delta['content'])
                    if 'tool_calls' in delta and delta['tool_calls']:
                        for tc in delta['tool_calls']:
                            idx = tc.get('index', 0)
                            if idx not in accumulated_tool_calls:
                                accumulated_tool_calls[idx] = {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}}
                            if tc.get('id'):
                                accumulated_tool_calls[idx]['id'] += tc['id']
                            if tc.get('type'):
                                accumulated_tool_calls[idx]['type'] = tc['type']
                            if tc.get('function'):
                                fn = tc['function']
                                if fn.get('name'):
                                    accumulated_tool_calls[idx]['function']['name'] += fn['name']
                                if fn.get('arguments'):
                                    accumulated_tool_calls[idx]['function']['arguments'] += fn['arguments']
                    if chunk.get('usage') and isinstance(chunk['usage'], dict):
                        usage_dict.update({k: chunk['usage'][k] for k in ('prompt_tokens', 'completion_tokens', 'total_tokens') if isinstance(chunk['usage'].get(k), int)})

        message_dict = {'role': 'assistant'}
        if accumulated_content:
            message_dict['content'] = ''.join(accumulated_content)
        else:
            message_dict['content'] = None
        if accumulated_tool_calls:
            message_dict['tool_calls'] = [accumulated_tool_calls[i] for i in sorted(accumulated_tool_calls)]
        yield ('message', message_dict, usage_dict)

    except Exception:
        if not accumulated_content:
            message, usage = complete(messages, tools, response_schema, final=final)
            if message.get('content'):
                yield ('delta', message['content'])
            yield ('message', message, usage)
            return
        raise

