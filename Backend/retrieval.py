"""Small, versioned BM25 RAG index. No embeddings or external vector database."""

import json
import re
from collections import Counter
from functools import lru_cache
from math import log
from pathlib import Path

KNOWLEDGE_PATH = Path(__file__).with_name('knowledge') / 'travel-guidance.json'
STOP_WORDS = set('a an and are as at be by can do for from how i in is it me my of on or our should that the this to we what when where which with would you your'.split())
ALIASES = {'gas': 'fuel', 'gasoline': 'fuel', 'petrol': 'fuel', 'refueling': 'refuel',
           'raining': 'rain', 'rainy': 'rain', 'stopping': 'stop', 'stops': 'stop',
           'breaks': 'break', 'restaurants': 'restaurant', 'miles': 'range', 'eating': 'food'}


def tokens(text):
    return [ALIASES.get(word, word) for word in re.findall(r'[a-z0-9]+', text.lower()) if word not in STOP_WORDS]


@lru_cache(maxsize=1)
def knowledge():
    return json.loads(KNOWLEDGE_PATH.read_text(encoding='utf-8'))


def retrieve(query, limit=4):
    documents = knowledge()['documents']
    counts = [Counter(tokens(doc['title'] + ' ' + doc['tags'] + ' ' + doc['text'])) for doc in documents]
    lengths = [sum(count.values()) for count in counts]
    average = sum(lengths) / len(lengths)
    query_words = set(tokens(query[:1600]))
    results = []
    for doc, count, length in zip(documents, counts, lengths):
        score = 0
        for word in query_words:
            frequency = count[word]
            containing = sum(word in other for other in counts)
            inverse = log(1 + (len(documents) - containing + .5) / (containing + .5))
            score += inverse * frequency * 2.5 / (frequency + 1.5 * (.25 + .75 * length / average))
        if score > 0:
            results.append({key: doc[key] for key in ('id', 'title', 'url', 'text')} | {'score': round(score, 3)})
    return sorted(results, key=lambda doc: (-doc['score'], doc['id']))[:max(1, min(4, limit))]
