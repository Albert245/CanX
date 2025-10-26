import os
from Find_lines_with_SubStrings import*
import cantools
 
OUTPUT_PATH = "output"
 
def Remove_duplicates(arr):
    seen = set()
    result = []
    for sub_arr in arr:
        first_sub = sub_arr[0]
        if first_sub not in seen:
            seen.add(first_sub)
            result.append(sub_arr)
    return result
 
def Get_signals_TimeoutTime(dbc_path):
    substrings = ['GenSigTimeoutTime','BA_REL_']
    data = find_lines_with_substrings(dbc_path,substrings)
    extracted_data = {}
    for idx in range(len(data)):
        extracted_data[data[idx][-2]] = str(data[idx][-1].replace(';',''))
    return(extracted_data)
 
def Get_signals_sign(dbc_path):
    data = find_lines_begin_with_substring(dbc_path," SG_ ")
    extracted_data = {}
    for idx in range(len(data)):
        extracted_data[data[idx][1]] = data[idx][3].split("@")[-1]
    return extracted_data
 
def Get_messages_nodes(dbc_path, nodes = ['']):
    substrings = 'BO_'
    data = find_lines_begin_with_substring(dbc_path,substrings)
    extracted_data = []
    for idx in range(len(data)):
        temp = []
        temp.append(data[idx][2])
        temp.append(data[idx][-1])
        if (nodes[0] == ''):
            extracted_data.append(temp)
        else:
            for node in nodes:
                if (node == data[idx][-1]):
                    extracted_data.append(temp)
    result = Remove_duplicates(extracted_data)
    return(result)
 
def get_messages_timeout(message):
    out = []
    for message in messages:
        idx = message.frame_id
        if message.is_extended_frame:
            idx = int(idx|0x80000000)
        try:
            for signal in dbc_content.dbc.attributes_rel[idx]["signal"].keys():
                # print(signal)
                for node in dbc_content.dbc.attributes_rel[idx]["signal"][signal]['node'].keys():
                    cont = dbc_content.dbc.attributes_rel[idx]["signal"][signal]['node'][node]["GenSigTimeoutTime"]
                    out[message.name] = cont.value
                    # print(cont.value)
                    break
                break
 
        except:
            out[message.name] = 0
    return out
 
def Get_dbc_info(dbc_path):
    # Load the DBC file
    dbc_file_path = (f'{dbc_path}.dbc')
    dbc = cantools.database.load_file(dbc_file_path)
    messages = sorted(dbc_content.messages,key=lambda msg:msg.name)
    timeout_list = Get_signals_TimeoutTime(dbc_file_path)
    sign_list = Get_signals_sign(dbc_file_path)
 
    # Extract DBC data
    dbc_messages = {}
 
    for message in dbc.messages:
        signals_data = {}
        for signal in message.signals:
            try:
                timeout_time = timeout_list[signal.name]
            except:
                timeout_time = "0"
            signals_data[signal.name] = {
                "start_bit": signal.start,
                "length": signal.length,
                "scaling": signal.scale,
                "offset": signal.offset,
                "initial": signal.raw_initial,
                "min": signal.minimum,
                "max": signal.maximum,
                "unit": signal.unit,
                "receivers": signal.receivers,
                "comment": signal.comment,
                "message" : message.name,
                "timeout" : timeout_time,
                "sign" : sign_list[signal.name]
            }
        dbc_messages[message.name] = {
            "frame_id": message.frame_id,
            "is_extended_frame": message.is_extended_frame,
            "cycle_time": message.cycle_time,
            "transmitter": message.senders,
            "signals": signals_data,
            "comment": message.comment,
        }
    return dbc_messages
 
 