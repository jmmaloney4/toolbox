#!/usr/bin/env python3
"""
Pulumi Stack Detection Script

Detects Pulumi stacks in a repository and generates a deployment matrix.
Supports filtering by include/exclude patterns.
"""

import argparse
import json
import os
import re
from pathlib import Path
from typing import List, Dict


def find_pulumi_stacks(working_dir: Path) -> List[Dict[str, str]]:
    """Find all Pulumi stack files and extract project/stack information."""
    stacks = []
    
    print(f"Searching for Pulumi stack files in: {working_dir.absolute()}")
    
    # Find all Pulumi.*.yaml and Pulumi.*.yml files
    for pattern in ["Pulumi.*.yaml", "Pulumi.*.yml"]:
        print(f"Searching for pattern: {pattern}")
        found_files = list(working_dir.rglob(pattern))
        print(f"Found {len(found_files)} files matching {pattern}")
        
        for pulumi_file in found_files:
            print(f"Processing file: {pulumi_file}")
            
            # Extract stack name from filename
            match = re.match(r"Pulumi\.(.+)\.ya?ml$", pulumi_file.name)
            if not match:
                print(f"  Skipping {pulumi_file.name}: doesn't match pattern")
                continue
            if match.group(1) in ("yaml", "yml"):
                print(f"  Skipping {pulumi_file.name}: invalid stack name")
                continue
                
            stack_name = match.group(1)
            
            # Determine project path relative to working directory
            project_dir = pulumi_file.parent.relative_to(working_dir)
            project_path = "." if project_dir == Path(".") else str(project_dir)
            
            # Avoid duplicates (in case both .yaml and .yml exist for same stack)
            stack_entry = {
                "project": project_path,
                "stack": stack_name
            }
            if stack_entry not in stacks:
                stacks.append(stack_entry)
                print(f"Found stack: {stack_name} in project: {project_path}")
            else:
                print(f"Duplicate stack entry, skipping: {stack_name} in {project_path}")
    
    print(f"Total unique stacks found: {len(stacks)}")
    return stacks


def filter_stacks(stacks: List[Dict[str, str]], include: List[str], exclude: List[str]) -> List[Dict[str, str]]:
    """Filter stacks by include/exclude patterns."""
    filtered = stacks
    
    # Apply include filter
    if include:
        include_set = {s.strip() for s in include if s.strip()}
        filtered = [s for s in filtered if s["stack"] in include_set]
        print(f"Applied include filter: {include_set}")
    
    # Apply exclude filter
    if exclude:
        exclude_set = {s.strip() for s in exclude if s.strip()}
        filtered = [s for s in filtered if s["stack"] not in exclude_set]
        print(f"Applied exclude filter: {exclude_set}")
    
    return filtered


def main():
    parser = argparse.ArgumentParser(description="Detect Pulumi stacks and generate deployment matrix")
    parser.add_argument("--working-directory", "-d", type=Path, default=Path("."), help="Working directory to search")
    parser.add_argument("--include-stacks", help="Comma-separated list of stacks to include")
    parser.add_argument("--exclude-stacks", help="Comma-separated list of stacks to exclude")
    
    args = parser.parse_args()
    
    print("=== Pulumi Stack Detection ===")
    print(f"Working directory: {args.working_directory.absolute()}")
    
    # Change to working directory
    os.chdir(args.working_directory)
    
    stacks = []
    
    # Detect stacks using Python filesystem detection
    print("Using Python filesystem detection...")
    stacks = find_pulumi_stacks(Path("."))
    
    print(f"Raw detected matrix: {json.dumps(stacks, indent=2)}")
    
    # Apply filters
    include_list = []
    exclude_list = []
    
    if args.include_stacks:
        include_list = [s.strip() for s in args.include_stacks.split(",") if s.strip()]
    
    if args.exclude_stacks:
        exclude_list = [s.strip() for s in args.exclude_stacks.split(",") if s.strip()]
    
    if include_list or exclude_list:
        stacks = filter_stacks(stacks, include_list, exclude_list)
    
    # Output results
    matrix_json = json.dumps(stacks, separators=(',', ':'))
    count = len(stacks)
    has_stacks = count > 0
    
    print(f"Final matrix: {matrix_json}")
    print(f"Count: {count}")
    print(f"Has stacks: {has_stacks}")
    
    # Set GitHub Actions outputs if in CI
    if "GITHUB_OUTPUT" in os.environ:
        # GitHub Actions expects lowercase true/false strings for booleans
        has_stacks_str = "true" if has_stacks else "false"
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"matrix={matrix_json}\n")
            f.write(f"count={count}\n")
            f.write(f"has_stacks={has_stacks_str}\n")
    


if __name__ == "__main__":
    main()
