class MotorError(Exception):
    """Base class for actionable user-facing errors."""


class ReportValidationError(MotorError):
    """The report specification or one of its sources is invalid."""


class ArtifactInspectionError(MotorError):
    """An HTML file does not contain a readable motor manifest."""
