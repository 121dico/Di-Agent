"""Only public text; do not count chat templates or add special tokens."""
import hashlib
import json
import pathlib
import sys
from tokenizers import Tokenizer

path = pathlib.Path(__file__).with_name('deepseek-v4.json')
if hashlib.sha256(path.read_bytes()).hexdigest() != '8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf':
    raise ValueError('Tokenizer checksum mismatch')
texts = json.load(sys.stdin)
if not isinstance(texts, list) or any(not isinstance(x, str) for x in texts):
    raise ValueError('Expected text array')
tokenizer = Tokenizer.from_file(str(path))
print(json.dumps([len(x.ids) for x in tokenizer.encode_batch(texts, add_special_tokens=False)]))
