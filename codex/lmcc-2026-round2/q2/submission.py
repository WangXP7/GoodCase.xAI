def process_data(records):
    """按题面清洗格式、复制已有标签并稳定去重，不判断括号合法性。"""
    if not isinstance(records, list):
        raise ValueError("records must be a list")

    result = []
    seen = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        sequence = record.get("sequence")
        valid = record.get("valid")
        if not isinstance(sequence, str) or not isinstance(valid, str):
            continue

        sequence = "".join(sequence.split())
        if not 2 <= len(sequence) <= 12:
            continue
        if any(char not in "()" for char in sequence):
            continue

        valid = valid.strip().upper()
        if valid not in ("YES", "NO"):
            continue
        input_text = "序列：" + sequence
        output_text = "[Valid]: " + valid

        if input_text in seen:
            if seen[input_text] != output_text:
                raise ValueError("conflicting labels")
            continue
        seen[input_text] = output_text
        result.append({"input": input_text, "output": output_text})
    return result
