# Renovate Presets

This directory contains composable Renovate presets that can be shared across projects.

## Available Presets

### Core Presets

- **`default.json`** - Base Renovate configuration with common settings
- **`all.json`** - Aggregate preset that includes all presets in this repo
- **`security.json`** - Security-focused package rules and vulnerability handling
- **`lock-maintenance.json`** - Lock file maintenance configuration
- **`package-groups.json`** - Package groupings for common technology stacks

### Technology-Specific Presets

- **`nix.json`** - Nix-specific configuration with regex managers
- **`pulumi.json`** - Pulumi-specific configuration and version management

## Usage

To use these presets in your Renovate configuration, extend them using the GitHub preset syntax:

```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/default.json",
    "github>jmmaloney4/toolbox//renovate:nix",
    "github>jmmaloney4/toolbox//renovate:security"
  ]
}
```

Alternatively, you can use the aggregate preset to include everything from this repository in one line:

```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/all.json"
  ]
}
```

### Preset Resolution Examples

- `github>jmmaloney4/toolbox//renovate/default.json` → loads `renovate/default.json`
- `github>jmmaloney4/toolbox//renovate/all.json` → loads `renovate/all.json`
- `github>jmmaloney4/toolbox//renovate/nix.json` → loads `renovate/nix.json`
- `github>jmmaloney4/toolbox//renovate/security.json` → loads `renovate/security.json`

### Pinning to Releases

For production use, consider pinning to a specific release:

```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/default.json#v1.0.0"
  ]
}
```

Or pin the aggregate preset:

```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/all.json#v1.0.0"
  ]
}
```

## Preset Composition

The presets are designed to be composable. Common combinations:

### Full-Featured Project
```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/default.json",
    "github>jmmaloney4/toolbox//renovate/security.json",
    "github>jmmaloney4/toolbox//renovate/package-groups.json",
    "github>jmmaloney4/toolbox//renovate/lock-maintenance.json"
  ]
}
```
Alternatively, use the single aggregate preset:

```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/all.json"
  ]
}
```

### Nix + Pulumi Project
```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/default.json",
    "github>jmmaloney4/toolbox//renovate/nix.json",
    "github>jmmaloney4/toolbox//renovate/pulumi.json"
  ]
}
```
Alternatively, use the single aggregate preset:

```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/all.json"
  ]
}
```

## Valid Configuration File Locations

Renovate looks for configuration files in these locations (in order):

1. `renovate.json`
2. `renovate.json5` 
3. `.github/renovate.json`
4. `.github/renovate.json5`
5. `.gitlab/renovate.json`
6. `.gitlab/renovate.json5`
7. `.renovaterc`
8. `.renovaterc.json`
9. `.renovaterc.json5`
10. `package.json` (within a `"renovate"` section - deprecated)

Renovate stops searching after finding the first matching configuration file.

## Override Behavior

Settings defined directly in your configuration file will override preset settings due to Renovate's merge precedence rules.
