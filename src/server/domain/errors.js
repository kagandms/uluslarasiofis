export class ApplicationConflictError extends Error {
    constructor() {
        super('An active application already exists for this student.');
        this.name = 'ApplicationConflictError';
        this.code = 'APPLICATION_ALREADY_ACTIVE';
    }
}

export class ApplicationTypeChangeBlockedError extends Error {
    constructor() {
        super('An existing document requirement cannot be mapped safely to the requested application type.');
        this.name = 'ApplicationTypeChangeBlockedError';
        this.code = 'APPLICATION_TYPE_CHANGE_BLOCKED';
    }
}

export class RepositoryConfigurationError extends Error {
    constructor() {
        super('A required repository binding is unavailable.');
        this.name = 'RepositoryConfigurationError';
        this.code = 'REPOSITORY_CONFIGURATION_ERROR';
    }
}

export class ApiError extends Error {
    constructor(status, code, message, retryable = false) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.retryable = retryable;
    }
}
