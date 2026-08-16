USE Controltable;
GO

IF OBJECT_ID('dbo.Controltable', 'U') IS NOT NULL
    DROP TABLE dbo.Controltable;
GO

CREATE TABLE dbo.Controltable (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    NID NVARCHAR(50),
    YearMonth NVARCHAR(50),
    MainCat NVARCHAR(100),
    SubCat NVARCHAR(100),
    Status NVARCHAR(50),
    NotesLink NVARCHAR(500),
    EmsOwner NVARCHAR(50),
    MsdOwner NVARCHAR(50),
    SpecStart NVARCHAR(50),
    SpecEnd NVARCHAR(50),
    SpecHistory NVARCHAR(MAX),
    MsdConfirm NVARCHAR(50),
    MsdStart NVARCHAR(50),
    MsdEnd NVARCHAR(50),
    MsdHistory NVARCHAR(MAX),
    UatStart NVARCHAR(50),
    UatEnd NVARCHAR(50),
    UatHistory NVARCHAR(MAX),
    CurrentStatus NVARCHAR(MAX),
    MpSaving INT
);
GO
