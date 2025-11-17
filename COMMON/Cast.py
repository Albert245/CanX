'''
Author: NhatPM7
Description: This Library provide casting functions
Last update: 22-Jan-2025
    - First Initial
'''
 
# '''
# <-7BB: 10 4F 59 02 09 92 81 11
# ->7B3: 30 00 14 00 00 00 00 00
# <-7BB: 21 09 97 73 88 09 98 7C
# <-7BB: 22 88 09 92 4A 88 09 98
# <-7BB: 23 BC 92 09 92 AD 13 09
# <-7BB: 24 92 CF 13 09 92 D1 13
# <-7BB: 25 09 92 DA 13 09 92 DD
# <-7BB: 26 13 09 D9 11 88 09 D9
# <-7BB: 27 12 88 09 D9 10 88 09
# <-7BB: 28 D9 13 88 09 92 BF 13
# <-7BB: 29 09 92 A0 13 09 92 75
# <-7BB: 2A 13 09 92 E0 13 09 98
# <-7BB: 2B BB 88 09 AA AA AA AA
 
# ->7b3: 03 22 F1 87 00 00 00 00
# <-7BB: 10 0D 62 F1 87 39 37 32
# <-7BB: 21 35 35 44 43 30 31 30'''
 
def Hex(input_value:int):
    '''
    Convert interger into hex string
    Eg:  (int)0x0F0F -> '0F 0F'(str)
    '''
    temp = hex(input_value)[2:]
    if len(temp) % 2 != 0:
        temp = '0' + temp
    output = ' '.join(Split_by_num(temp,2))
    return output.upper()
 
def Split_by_num(input_str:str, num:int):
    '''
    Split input string into list with length = num (input)
    Eg: input_str = '123456', num = 3 --> ['123','456']
    '''
    return [input_str[i:i+num] for i in range(0, len(input_str),num)]
 
def HexArr2Str(msg:list):
    '''
    Convert array of bytes in message into string
    Eg: 0xF100(in hex) --> 'F1 00'(in string)
    '''
    ret = ''
    for val in msg:
        temp = str(hex(val))[2:]
        if len(temp)<2:
            temp = '0' + temp
        ret = ret + temp + ' '
    return ret.upper()
 
def HexArr2StrArr(msg:list):
    '''
    Convert array of bytes in message into string
    Eg: 0xF100(in hex) --> ['F1','00']
    '''
    ret = []
    for val in msg:
        temp = str(hex(val))[2:]
        if len(temp)<2:
            temp = '0' + temp
        ret.append(temp.upper())
    return ret
 
 
def Str2HexArr(input_str):
    '''
    Convert string of hex into list of int(hex)
    Eg: (str)'22 F100' --> [0x22, 0xF1, 0x00] (hex)
    '''
    input_str = input_str.replace(' ','').upper()
    while len(input_str) % 2 != 0:
        input_str = input_str + '0'
    # data_len = hex(int(len(input_str)/2))[2:]
 
    # if len(data_len) < 2:
    #     data_len = '0' + data_len
    # input_str = data_len + input_str
 
    return [int(input_str[i:i+2],16) for i in range(0, len(input_str),2)]
 
def Str2StrArr(input_str):
    return Split_by_num(input_str=input_str,num=2)
 
def StrArr2Str(input_str,sub_str = ''):
    return sub_str.join(input_str)
 
def StrArr2Int(input_str):
    # print(f'input:{'0x'+StrArr2Str(input_str)}')
    return int(StrArr2Str(input_str),16)
 
def calculateLength_dlc(input_arr:list):
    """
    Calculate the length of the message must be on CAN-FD
    """
    Data_size = [12,16,20,24,36,48,64]
    arr_len = len(input_arr)
    if arr_len > 64:
        return 0xff
    elif arr_len <= 8:
        return arr_len
    for i in range(len(Data_size)):
        if arr_len <= Data_size[i]:
            return Data_size[i]
 
def Correct_Str_Hex(input_str):
    """
    Correct the string's format into 'XX XX XX'
    """
    temp = Split_by_num(input_str.replace(' ',''),2)
    return ' '.join(temp).upper()
 
def add_padding(input_arr:list, padding):
    """
    Add padding for a frame CAN-FD
    """
    Data_size = calculateLength_dlc(input_arr)
    outdata = list(input_arr)
    outdata.extend([int(padding,16)]*(Data_size-len(input_arr)))
    return outdata
 
def trim(value, min_val, max_val):
    """Clamp *value* between *min_val* and *max_val* when the bounds exist."""

    if min_val is not None:
        value = max(min_val, value)
    if max_val is not None:
        value = min(value, max_val)
    return value
