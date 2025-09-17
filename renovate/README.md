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
    "github>jmmaloney4/workflows//renovate:all"
  ]
}
```

### Preset Resolution Examples

- `github>jmmaloney4/workflows//renovate:default` → loads `renovate/default.json`
- `github>jmmaloney4/workflows//renovate:all` → loads `renovate/all.json`
- `github>jmmaloney4/workflows//renovate:nix` → loads `renovate/nix.json`
- `github>jmmaloney4/workflows//renovate:security` → loads `renovate/security.json`

### Pinning to Releases

For production use, consider pinning to a specific release:

```json
{
  "extends": [
    "github>jmmaloney4/workflows//renovate:all#v1.0.0"
  ]
}
```

## Preset Composition

The presets are designed to be composable. Common combinations:

### Full-Featured Project
```json
{
  "extends": [
    "github>jmmaloney4/workflows//renovate:all"
  ]
}
```

### Nix + Pulumi Project
```json
{
  "extends": [
    "github>jmmaloney4/workflows//renovate:all"
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