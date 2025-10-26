import os
 
 
def find_lines_with_substrings(file_path,substrings:list):
    matching_lines = []
    with open(file_path,'r',errors="ignore") as file:
        for line in file:
            if all(substring in line for substring in substrings):
                matching_lines.append(line.strip().split(" "))
    return matching_lines
 
def find_idx_with_substrings(input_arr,substrings:list):
    matching_lines = 0
    for idx,line in enumerate(input_arr):
        if all(substring in line for substring in substrings):
            matching_lines = idx + 1
    return matching_lines
 
def find_lines_begin_with_substring(file_path,substring:str):
    matching_lines = []
    with open(file_path,'r') as file:
        for line in file:
            if line[:len(substring)] == substring:
                matching_lines.append(line.strip().split(" "))
    return matching_lines