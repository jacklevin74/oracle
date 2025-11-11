use anchor_lang::prelude::*;

#[error_code]
pub enum OracleError {
    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Unauthorized for this updater index")]
    UnauthorizedForIndex,

    #[msg("Invalid updater index (must be 1-4)")]
    BadIndex,

    #[msg("Invalid public key")]
    BadKey,

    #[msg("Asset already registered")]
    AssetAlreadyRegistered,

    #[msg("Asset not found")]
    AssetNotFound,

    #[msg("Asset is not active")]
    AssetInactive,

    #[msg("Symbol too long (max 16 bytes)")]
    SymbolTooLong,

    #[msg("Price is stale")]
    StalePrice,

    #[msg("Invalid price (must be positive)")]
    InvalidPrice,

    #[msg("Too many assets in batch")]
    TooManyAssets,
}
